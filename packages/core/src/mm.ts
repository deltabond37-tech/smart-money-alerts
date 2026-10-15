import type { Fill, Thresholds } from "./types.js";

export interface MarketMakerStats {
  fills: number;
  hours: number;
  fillsPerDay: number;
  /** notional-weighted: Σ_coin |net signed notional| / Σ|notional| (0 = pure churn, 1 = one-directional) */
  driftRatio: number;
  sumAbsNotional: number;
  netAbsNotional: number;
}

/** Signed size of a fill from its side: B = buy (+), A = sell (-). */
export function signedFillSize(f: Fill): number {
  return f.side === "B" ? f.sz : -f.sz;
}

/**
 * Churn statistics over a set of fills (normally the trailing 24h). Drift is notional-weighted so a coin
 * with millions of cheap units cannot dominate; per-coin net drift is summed in absolute terms so hedged
 * activity across coins still reads as churn.
 */
export function marketMakerStats(fills: Fill[], hours = 24): MarketMakerStats {
  const netByCoin = new Map<string, number>();
  let sumAbs = 0;
  for (const f of fills) {
    const notional = f.sz * f.px;
    sumAbs += notional;
    netByCoin.set(f.coin, (netByCoin.get(f.coin) ?? 0) + signedFillSize(f) * f.px);
  }
  let netAbs = 0;
  for (const v of netByCoin.values()) netAbs += Math.abs(v);
  const fillsPerDay = (fills.length / Math.max(hours, 1e-9)) * 24;
  return {
    fills: fills.length,
    hours,
    fillsPerDay,
    driftRatio: sumAbs > 0 ? netAbs / sumAbs : 1,
    sumAbsNotional: sumAbs,
    netAbsNotional: netAbs,
  };
}

/** Fills/day at this multiple of the threshold is flagged regardless of drift (pure HFT accounts drift too). */
export const MM_HARD_FILLS_MULTIPLIER = 10;

export function isLikelyMarketMaker(stats: MarketMakerStats, t: Thresholds["mm"]): boolean {
  if (stats.fillsPerDay > t.fills_per_day * MM_HARD_FILLS_MULTIPLIER) return true;
  return stats.fillsPerDay > t.fills_per_day && stats.driftRatio < t.drift_ratio;
}
