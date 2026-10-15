import { describe, expect, it } from "vitest";
import { DEFAULT_THRESHOLDS, mergeThresholds, resolveRules, type RuleSet } from "../src/rules.js";
import type { AlertRule } from "../src/types.js";
import { wallet } from "./helpers.js";

const rule = (o: Partial<AlertRule>): AlertRule => ({
  scope: "global",
  scopeRef: null,
  eventTypes: ["OPEN", "CLOSE", "INCREASE", "DECREASE", "FLIP"],
  thresholds: {},
  routing: {},
  enabled: true,
  ...o,
});

describe("rules", () => {
  it("defaults parse and partial merge wins per key", () => {
    expect(DEFAULT_THRESHOLDS.min_delta_notional_usd).toBe(25_000);
    const t = mergeThresholds({ min_delta_notional_usd: 1 }, { dust: { pct: 9, usd: 9 } }, { min_delta_notional_usd: 2 });
    expect(t.min_delta_notional_usd).toBe(2);
    expect(t.dust).toEqual({ pct: 9, usd: 9 });
    expect(t.cooldown_sec).toBe(1800);
    expect(mergeThresholds({ dust: { pct: 9, usd: 9 } }, { dust: { pct: 1 } }).dust).toEqual({ pct: 1, usd: 9 }); // one-level deep merge
  });

  it("precedence: global < coin_tier < wallet rule < wallet.overrides", () => {
    const rs: RuleSet = {
      rules: [
        rule({ thresholds: { min_delta_notional_usd: 25_000 }, eventTypes: ["OPEN", "FLIP"], routing: { high: "#g-high" } }),
        rule({ scope: "coin_tier", scopeRef: "major", thresholds: { min_delta_notional_usd: 50_000 } }),
        rule({ scope: "wallet", scopeRef: "0x0000000000000000000000000000000000000a01", thresholds: { min_delta_notional_usd: 75_000 }, routing: { high: "#w-high" } }),
      ],
      coinTiers: { BTC: "major" },
    };
    const w = wallet({ overrides: { cooldown_sec: 5 } });
    const btc = resolveRules(rs, w, "BTC");
    expect(btc.thresholds.min_delta_notional_usd).toBe(75_000);
    expect(btc.thresholds.cooldown_sec).toBe(5);
    expect(btc.thresholds.event_types).toEqual(["OPEN", "FLIP"]); // tier/wallet rules don't reset event types
    expect(btc.routing.high).toBe("#w-high");

    const unknown = resolveRules(rs, wallet({ address: "0x00000000000000000000000000000000000000ff" }), "DOGE");
    expect(unknown.thresholds.min_delta_notional_usd).toBe(25_000); // DOGE -> long_tail (no rule) -> global
  });

  it("disabled rules are skipped; invalid overrides throw", () => {
    const rs: RuleSet = { rules: [rule({ thresholds: { min_delta_notional_usd: 1 }, enabled: false })], coinTiers: {} };
    expect(resolveRules(rs, wallet(), "ETH").thresholds.min_delta_notional_usd).toBe(25_000);
    expect(() => mergeThresholds({ min_delta_notional_usd: -1 })).toThrow();
  });
});
