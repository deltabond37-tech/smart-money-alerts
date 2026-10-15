import { describe, expect, it } from "vitest";
import { evaluateFilters } from "../src/filter.js";
import { event, NO_CTX, T0, thresholds } from "./helpers.js";

describe("evaluateFilters", () => {
  const t = thresholds();

  it("passes a clean OPEN above all thresholds", () => {
    expect(evaluateFilters(event(), t, NO_CTX)).toEqual({ pass: true, reason: null });
  });

  it("muted wallet", () => {
    expect(evaluateFilters(event(), t, { ...NO_CTX, muted: true }).reason).toBe("muted");
  });

  it("mm flagged, unless ignore_mm_flag override", () => {
    expect(evaluateFilters(event(), t, { ...NO_CTX, mmFlagged: true }).reason).toBe("mm_flagged");
    expect(evaluateFilters(event(), thresholds({ ignore_mm_flag: true }), { ...NO_CTX, mmFlagged: true }).pass).toBe(true);
  });

  it("event type disabled", () => {
    const tt = thresholds({ event_types: ["OPEN", "FLIP"] });
    expect(evaluateFilters(event({ eventType: "DECREASE", s0: 10, s1: 5, pctChange: 50 }), tt, NO_CTX).reason).toBe("event_type_disabled");
  });

  it("coin blacklist / whitelist (case-insensitive)", () => {
    expect(evaluateFilters(event(), thresholds({ coin_blacklist: ["eth"] }), NO_CTX).reason).toBe("coin_blacklist");
    expect(evaluateFilters(event(), thresholds({ coin_whitelist: ["BTC"] }), NO_CTX).reason).toBe("coin_not_whitelisted");
    expect(evaluateFilters(event(), thresholds({ coin_whitelist: ["eth"] }), NO_CTX).pass).toBe(true);
  });

  it("dust: small in BOTH pct and usd", () => {
    const ev = event({ eventType: "INCREASE", s0: 100, s1: 101, deltaSize: 1, pctChange: 1, deltaNotionalUsd: 1500 });
    expect(evaluateFilters(ev, t, NO_CTX).reason).toBe("dust");
    // small pct but big usd -> not dust (falls to min_pct_change)
    const ev2 = event({ eventType: "INCREASE", s0: 1000, s1: 1010, deltaSize: 10, pctChange: 1, deltaNotionalUsd: 30_000 });
    expect(evaluateFilters(ev2, t, NO_CTX).reason).toBe("min_pct_change");
    // big pct but tiny usd -> not dust (falls to min_delta_notional)
    const ev3 = event({ eventType: "INCREASE", s0: 0.1, s1: 0.2, deltaSize: 0.1, pctChange: 100, deltaNotionalUsd: 300 });
    expect(evaluateFilters(ev3, t, NO_CTX).reason).toBe("min_delta_notional");
  });

  it("acceptance: $2k change on a wallet that normally trades $500k is filtered with a reason", () => {
    const ev = event({ eventType: "INCREASE", s0: 166, s1: 166.66, deltaSize: 0.66, pctChange: 0.4, deltaNotionalUsd: 2000 });
    const r = evaluateFilters(ev, t, NO_CTX);
    expect(r.pass).toBe(false);
    expect(["dust", "min_delta_notional"]).toContain(r.reason); // $2,000 sits exactly on the dust floor
  });

  it("min_delta_notional edge: exactly at threshold passes, one dollar below fails", () => {
    expect(evaluateFilters(event({ deltaNotionalUsd: 25_000 }), t, NO_CTX).pass).toBe(true);
    expect(evaluateFilters(event({ deltaNotionalUsd: 24_999 }), t, NO_CTX).reason).toBe("min_delta_notional");
  });

  it("min_pct_change applies only to INCREASE/DECREASE", () => {
    const inc = event({ eventType: "INCREASE", s0: 10, s1: 12, pctChange: 20, deltaNotionalUsd: 60_000 });
    expect(evaluateFilters(inc, t, NO_CTX).reason).toBe("min_pct_change");
    expect(evaluateFilters(event({ ...inc, pctChange: 25 }), t, NO_CTX).pass).toBe(true);
    const flip = event({ eventType: "FLIP", s0: 10, s1: -1, pctChange: 110, deltaNotionalUsd: 60_000 });
    expect(evaluateFilters(flip, t, NO_CTX).pass).toBe(true);
  });

  it("min_equity_pct", () => {
    expect(evaluateFilters(event({ equityPct: 1.9 }), t, NO_CTX).reason).toBe("min_equity_pct");
    expect(evaluateFilters(event({ equityPct: 2 }), t, NO_CTX).pass).toBe(true);
    expect(evaluateFilters(event({ equityPct: null }), t, NO_CTX).pass).toBe(true); // unknown equity does not block
  });

  it("leverage range", () => {
    expect(evaluateFilters(event({ leverage: 150 }), t, NO_CTX).reason).toBe("leverage_out_of_range");
    expect(evaluateFilters(event({ leverage: 3 }), thresholds({ min_leverage: 5 }), NO_CTX).reason).toBe("leverage_out_of_range");
  });

  it("CLOSE requires |realized pnl| >= threshold", () => {
    const close = event({ eventType: "CLOSE", s0: 10, s1: 0, pctChange: 100, newNotionalUsd: 0, realizedPnl: 4999 });
    expect(evaluateFilters(close, t, NO_CTX).reason).toBe("close_min_realized_pnl");
    expect(evaluateFilters(event({ ...close, realizedPnl: -5000 }), t, NO_CTX).pass).toBe(true);
  });

  it("cooldown blocks INCREASE/DECREASE/OPEN within window, never FLIP/CLOSE", () => {
    const ctx = { ...NO_CTX, lastAlertAt: T0 };
    const inc = event({ eventType: "INCREASE", s0: 10, s1: 20, pctChange: 100, windowEnd: T0 + 10 * 60_000 });
    expect(evaluateFilters(inc, t, ctx).reason).toBe("cooldown");
    expect(evaluateFilters(event({ ...inc, windowEnd: T0 + 30 * 60_000 }), t, ctx).pass).toBe(true); // exactly at 30 min passes
    const flip = event({ eventType: "FLIP", s0: 10, s1: -10, pctChange: 200, windowEnd: T0 + 60_000 });
    expect(evaluateFilters(flip, t, ctx).pass).toBe(true);
    const close = event({ eventType: "CLOSE", s0: 10, s1: 0, pctChange: 100, realizedPnl: 10_000, windowEnd: T0 + 60_000 });
    expect(evaluateFilters(close, t, ctx).pass).toBe(true);
  });
});
