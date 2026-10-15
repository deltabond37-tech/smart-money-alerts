import { describe, expect, it } from "vitest";
import { decide } from "../src/pipeline.js";
import { routeByScore, scoreEvent, statsOf } from "../src/scorer.js";
import { event, NO_CTX, thresholds } from "./helpers.js";

const t = thresholds();
const baseInput = { walletTier: "C" as const, coinTier: "mid" as const, confluenceCount: 0 };

describe("scoreEvent", () => {
  it("z-score path: wallet-relative size dominates", () => {
    const stats = statsOf([100_000, 120_000, 90_000, 110_000, 80_000]); // mean 100k
    const big = scoreEvent(event({ deltaNotionalUsd: 100_000 + 3 * stats.stddev! }), { ...baseInput, walletStats: stats }, t);
    expect(big.components.size_z).toBe(35);
    expect(big.components.z).toBeCloseTo(3, 1);
    expect(big.components.z_fallback).toBe(false);
    const typical = scoreEvent(event({ deltaNotionalUsd: 100_000 }), { ...baseInput, walletStats: stats }, t);
    expect(typical.components.size_z).toBe(0);
    expect(typical.score).toBeLessThan(big.score);
  });

  it("$2k on a $500k wallet scores near floor and routes nowhere", () => {
    const stats = statsOf([500_000, 450_000, 550_000, 500_000, 480_000, 520_000]);
    const r = scoreEvent(event({ deltaNotionalUsd: 2000, equityPct: 0.1 }), { ...baseInput, walletStats: stats }, t);
    expect(r.components.size_z).toBe(0);
    expect(r.components.z).toBeLessThan(-5);
    expect(routeByScore(r.score, t)).toBeNull();
  });

  it("falls back to absolute scale when history is thin", () => {
    const r = scoreEvent(event({ deltaNotionalUsd: 250_000 }), { ...baseInput, walletStats: statsOf([1, 2]) }, t);
    expect(r.components.z_fallback).toBe(true);
    expect(r.components.size_z).toBe(17.5); // 250k / 500k (mid) * 35
  });

  it("stores every component for audit and caps at 100", () => {
    const r = scoreEvent(
      event({ eventType: "FLIP", deltaNotionalUsd: 5_000_000, equityPct: 80 }),
      { walletStats: statsOf([]), walletTier: "A", coinTier: "major", confluenceCount: 2 },
      t,
    );
    expect(r.components).toMatchObject({ size_z: 35, equity_pct: 25, tier: 15, event_type: 15, confluence: 10 });
    expect(r.score).toBe(100);
  });

  it("event type weights order FLIP/OPEN > INCREASE > DECREASE/CLOSE", () => {
    const s = (eventType: "FLIP" | "OPEN" | "INCREASE" | "DECREASE" | "CLOSE") =>
      scoreEvent(event({ eventType }), { ...baseInput, walletStats: statsOf([]) }, t).score;
    expect(s("FLIP")).toBeGreaterThan(s("OPEN"));
    expect(s("OPEN")).toBeGreaterThan(s("INCREASE"));
    expect(s("INCREASE")).toBeGreaterThan(s("DECREASE"));
    expect(s("DECREASE")).toBe(s("CLOSE"));
  });
});

describe("routeByScore / decide", () => {
  it("routes by thresholds with inclusive edges", () => {
    expect(routeByScore(70, t)).toBe("high");
    expect(routeByScore(69, t)).toBe("feed");
    expect(routeByScore(40, t)).toBe("feed");
    expect(routeByScore(39, t)).toBeNull();
  });

  it("decide: filtered events still carry a score; low score becomes below_score_threshold", () => {
    const d = decide(event({ deltaNotionalUsd: 100 }), t, NO_CTX, { ...baseInput, walletStats: statsOf([]) });
    expect(d.filtered).toBe(true);
    expect(d.filterReason).toBe("min_delta_notional");
    expect(typeof d.score).toBe("number");
    const low = decide(event({ deltaNotionalUsd: 25_000, equityPct: 2 }), t, NO_CTX, { ...baseInput, walletStats: statsOf([]) });
    expect(low.filterReason).toBe("below_score_threshold");
    const hi = decide(
      event({ eventType: "FLIP", deltaNotionalUsd: 2_000_000, equityPct: 50 }),
      t,
      NO_CTX,
      { walletStats: statsOf([]), walletTier: "A", coinTier: "major", confluenceCount: 1 },
    );
    expect(hi.filtered).toBe(false);
    expect(hi.channel).toBe("high");
  });
});
