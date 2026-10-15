import { describe, expect, it } from "vitest";
import { computePollIntervalSec, cycleWeight, fillsWeight, TokenBucket } from "../src/budget.js";
import { isLikelyMarketMaker, marketMakerStats } from "../src/mm.js";
import { replay, type ReplayEvent } from "../src/replay.js";
import { formatClusterMessage, formatEventMessage, fmtUsd, headerLabel } from "../src/slack/format.js";
import { DEFAULT_THRESHOLDS } from "../src/rules.js";
import { event, fill, T0, W1, W2, W3, wallet } from "./helpers.js";

describe("budget", () => {
  it("weights and interval", () => {
    expect(cycleWeight(50)).toBe(102);
    expect(fillsWeight(0)).toBe(20);
    expect(fillsWeight(45)).toBe(22);
    expect(computePollIntervalSec(50, 800)).toBe(11); // 102 / (600/60) = 10.2 -> 11
    expect(computePollIntervalSec(3, 800)).toBe(5); // min interval
    expect(computePollIntervalSec(200, 800)).toBe(41);
  });

  it("token bucket waits when exhausted and refills over time", () => {
    let now = 0;
    const b = new TokenBucket(600, () => now);
    expect(b.take(500)).toBe(0);
    expect(b.take(200)).toBeGreaterThan(0); // -100 tokens -> wait 100 / (600/60000) = 10s
    expect(b.take(0)).toBe(10_000);
    now += 10_000;
    expect(b.available()).toBe(0);
    now += 60_000;
    expect(b.available()).toBe(600);
    expect(b.usedThisMinute()).toBe(0);
  });
});

describe("market maker detection", () => {
  it("flags high-churn, zero-drift wallets; not a directional trader", () => {
    const churn = Array.from({ length: 300 }, (_, i) => fill({ side: i % 2 ? "B" : "A", sz: 1, time: T0 + i * 1000 }));
    const s = marketMakerStats(churn, 24);
    expect(s.fillsPerDay).toBe(300);
    expect(s.driftRatio).toBe(0);
    expect(isLikelyMarketMaker(s, DEFAULT_THRESHOLDS.mm)).toBe(true);

    const directional = Array.from({ length: 300 }, () => fill({ side: "B", sz: 1 }));
    expect(isLikelyMarketMaker(marketMakerStats(directional, 24), DEFAULT_THRESHOLDS.mm)).toBe(false);
    // extreme HFT is flagged even when drifting (hard cap)
    const hft = Array.from({ length: 2500 }, (_, i) => fill({ side: i % 3 ? "B" : "A", sz: 1 }));
    expect(isLikelyMarketMaker(marketMakerStats(hft, 24), DEFAULT_THRESHOLDS.mm)).toBe(true);
    // drift is notional-weighted: a huge unit count in a cheap coin does not dominate
    const mixed = [
      ...Array.from({ length: 150 }, (_, i) => fill({ coin: "ETH", px: 3000, sz: 1, side: i % 2 ? "B" : "A" })),
      ...Array.from({ length: 150 }, () => fill({ coin: "CHEAP", px: 0.001, sz: 100_000, side: "B" })),
    ];
    expect(marketMakerStats(mixed, 24).driftRatio).toBeLessThan(0.1);
    expect(isLikelyMarketMaker(marketMakerStats(churn.slice(0, 50), 24), DEFAULT_THRESHOLDS.mm)).toBe(false);
  });
});

describe("replay", () => {
  it("counts alerts per channel, simulates cooldown, reports reasons", () => {
    const w1 = wallet({ id: W1, tier: "A" });
    const w2 = wallet({ id: W2, address: "0x0000000000000000000000000000000000000b02", tier: "C" });
    const mk = (id: string, o: Partial<ReplayEvent>): ReplayEvent => ({ ...event(o), id, ...o });
    const events: ReplayEvent[] = [
      mk("e1", { walletId: W1, eventType: "FLIP", deltaNotionalUsd: 3_000_000, equityPct: 60, windowEnd: T0 }),
      mk("e2", { walletId: W1, eventType: "INCREASE", s0: 10, s1: 20, pctChange: 100, deltaNotionalUsd: 500_000, equityPct: 30, windowEnd: T0 + 5 * 60_000 }),
      mk("e3", { walletId: W2, eventType: "OPEN", deltaNotionalUsd: 100, windowEnd: T0 + 6 * 60_000 }),
    ];
    const rs = { rules: [{ scope: "global" as const, scopeRef: null, eventTypes: [...DEFAULT_THRESHOLDS.event_types], thresholds: {}, routing: {}, enabled: true }], coinTiers: {} };
    const r = replay(events, rs, [w1, w2]);
    expect(r.total).toBe(3);
    expect(r.high).toBe(1);
    expect(r.byReason.cooldown).toBe(1);
    expect(r.byReason.min_delta_notional).toBe(1);

    const relaxed = { ...rs, rules: [{ ...rs.rules[0]!, thresholds: { cooldown_sec: 0 } }] };
    const r2 = replay(events, relaxed, [w1, w2]);
    expect(r2.high + r2.feed).toBe(2);
  });
});

describe("slack formatter", () => {
  it("builds header/fields/context blocks with IST time and links", () => {
    const ev = event({ windowEnd: Date.UTC(2026, 9, 13, 10, 0, 0) });
    const msg = formatEventMessage({ event: ev, wallet: wallet(), decision: { score: 77, components: { size_z: 20, equity_pct: 10, tier: 15, event_type: 12, confluence: 10, z: 1.7, z_fallback: false, wallet_mean: 1, wallet_stddev: 1, wallet_n: 10 } } });
    expect(msg.text).toBe("🟢 OPEN LONG ETH · Wallet A · score 77");
    expect(msg.blocks[0]!.type).toBe("header");
    const ctx = JSON.stringify(msg.blocks[2]);
    expect(ctx).toContain("15:30:00 IST");
    expect(ctx).toContain("hypurrscan.io/address/0x0000");
    expect(JSON.stringify(msg.blocks[3])).toContain("z 1.7");
    expect(headerLabel({ eventType: "OPEN", side: "short" })).toBe("🔴 OPEN SHORT");
    expect(headerLabel({ eventType: "FLIP", side: "long" })).toBe("🔄 FLIP → LONG");
  });

  it("cluster message lists wallets", () => {
    const msg = formatClusterMessage({
      cluster: { coin: "SOL", direction: "long", walletIds: [W1, W2, W3], eventIds: [], windowStart: T0, windowEnd: T0 + 30 * 60_000 },
      wallets: [wallet({ id: W1 }), wallet({ id: W2, label: "B" }), wallet({ id: W3, label: "C" })],
      k: 3,
      tMin: 60,
    });
    expect(msg.text).toBe("🚨 CLUSTER LONG SOL · 3 wallets");
    expect(JSON.stringify(msg.blocks)).toContain("*B*");
  });

  it("fmtUsd", () => {
    expect(fmtUsd(1_250_000)).toBe("$1.25M");
    expect(fmtUsd(-4500, { sign: true })).toBe("-$4.5k");
    expect(fmtUsd(12, { sign: true })).toBe("+$12");
    expect(fmtUsd(null)).toBe("—");
  });
});
