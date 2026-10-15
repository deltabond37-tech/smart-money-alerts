import { describe, expect, it } from "vitest";
import { mapClearinghouseState, mapFill } from "../src/adapters/hyperliquid/HyperliquidAdapter.js";
import { EnvSchema, loadEnv } from "../src/config.js";

describe("HyperliquidAdapter mapping", () => {
  it("maps clearinghouseState to positions with marks", () => {
    const snap = mapClearinghouseState(
      "0xabc",
      {
        marginSummary: { accountValue: "250000.5", totalNtlPos: "100000", totalRawUsd: "0", totalMarginUsed: "20000" },
        assetPositions: [
          { type: "oneWay", position: { coin: "ETH", szi: "-12.5", leverage: { type: "cross", value: 10 }, entryPx: "3100.2", positionValue: "37500", unrealizedPnl: "-120.5", liquidationPx: "3400.1", marginUsed: "3750" } },
          { type: "oneWay", position: { coin: "BTC", szi: "0", leverage: { type: "cross", value: 5 }, entryPx: null, positionValue: "0", unrealizedPnl: "0", liquidationPx: null, marginUsed: "0" } },
        ],
        time: 1760000000000,
      },
      { ETH: 3000 },
    );
    expect(snap.accountValue).toBe(250000.5);
    expect(snap.positions).toHaveLength(1);
    expect(snap.positions[0]).toMatchObject({ coin: "ETH", szi: -12.5, leverage: 10, entryPx: 3100.2, liqPx: 3400.1, unrealizedPnl: -120.5, markPx: 3000, accountValue: 250000.5 });
  });

  it("derives mark from positionValue when allMids is missing the coin", () => {
    const snap = mapClearinghouseState("0xabc", {
      marginSummary: { accountValue: "1", totalNtlPos: "0", totalRawUsd: "0", totalMarginUsed: "0" },
      assetPositions: [{ type: "oneWay", position: { coin: "XYZ", szi: "4", leverage: { type: "isolated", value: 3 }, entryPx: "10", positionValue: "48", unrealizedPnl: "8", liquidationPx: null, marginUsed: "16" } }],
      time: 0,
    });
    expect(snap.positions[0]!.markPx).toBe(12);
  });

  it("maps fills", () => {
    const f = mapFill({ coin: "SOL", px: "150.25", sz: "10", side: "A", time: 1760000000000, startPosition: "25", dir: "Close Long", closedPnl: "123.4", hash: "0xh", oid: 1, crossed: false, fee: "0.5", tid: 99 });
    expect(f).toMatchObject({ coin: "SOL", px: 150.25, sz: 10, side: "A", startPosition: 25, closedPnl: 123.4, crossed: false, fee: 0.5, tid: 99 });
  });
});

describe("env config", () => {
  const base = { SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service-role-key-xxxxxxxxxxxxxxxxx" };
  it("requires slack token unless dry run; --dry-run flag forces DRY_RUN", () => {
    expect(EnvSchema.safeParse(base).success).toBe(false);
    expect(EnvSchema.safeParse({ ...base, DRY_RUN: "true" }).success).toBe(true);
    const env = loadEnv(base, ["node", "x", "--dry-run"]);
    expect(env.DRY_RUN).toBe(true);
    expect(env.POLL_BUDGET_WEIGHT_PER_MIN).toBe(800);
  });
});
