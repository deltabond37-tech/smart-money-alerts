import type { CoinTier, EventType, PositionEvent, ScoreComponents, Thresholds, WalletStats, WalletTier } from "./types.js";

export const SCORE_WEIGHTS = {
  size_z_max: 35,
  equity_max: 25,
  tier: { A: 15, B: 8, C: 0 } as Record<WalletTier, number>,
  event_type: { FLIP: 15, OPEN: 12, INCREASE: 8, DECREASE: 4, CLOSE: 4 } as Record<EventType, number>,
  confluence: 10,
  /** z at which size component saturates */
  z_saturation: 3,
  /** equity % at which equity component saturates */
  equity_saturation_pct: 25,
  /** fallback absolute Δnotional (USD) that saturates the size component, by coin tier */
  fallback_saturation_usd: { major: 1_000_000, mid: 500_000, long_tail: 250_000 } as Record<CoinTier, number>,
} as const;

export interface ScoreInput {
  walletStats: WalletStats;
  walletTier: WalletTier;
  coinTier: CoinTier;
  /** number of OTHER tracked wallets with same coin+direction OPEN/INCREASE inside the cluster window */
  confluenceCount: number;
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

export function scoreEvent(ev: PositionEvent, input: ScoreInput, t: Thresholds): { score: number; components: ScoreComponents } {
  const { walletStats } = input;
  const absDelta = Math.abs(ev.deltaNotionalUsd);

  let z: number | null = null;
  let zFallback = false;
  let sizePts: number;
  if (
    walletStats.n >= t.zscore_min_samples &&
    walletStats.mean !== null &&
    walletStats.stddev !== null &&
    walletStats.stddev > 0
  ) {
    z = (absDelta - walletStats.mean) / walletStats.stddev;
    sizePts = clamp01(z / SCORE_WEIGHTS.z_saturation) * SCORE_WEIGHTS.size_z_max;
  } else {
    zFallback = true;
    const ref = SCORE_WEIGHTS.fallback_saturation_usd[input.coinTier];
    sizePts = clamp01(absDelta / ref) * SCORE_WEIGHTS.size_z_max;
  }

  const equityPts = clamp01((ev.equityPct ?? 0) / SCORE_WEIGHTS.equity_saturation_pct) * SCORE_WEIGHTS.equity_max;
  const tierPts = SCORE_WEIGHTS.tier[input.walletTier];
  const typePts = SCORE_WEIGHTS.event_type[ev.eventType];
  const confluencePts = input.confluenceCount >= 1 ? SCORE_WEIGHTS.confluence : 0;

  const components: ScoreComponents = {
    size_z: round1(sizePts),
    equity_pct: round1(equityPts),
    tier: tierPts,
    event_type: typePts,
    confluence: confluencePts,
    z: z === null ? null : round2(z),
    z_fallback: zFallback,
    wallet_mean: walletStats.mean,
    wallet_stddev: walletStats.stddev,
    wallet_n: walletStats.n,
  };
  const score = Math.min(100, Math.round(sizePts + equityPts + tierPts + typePts + confluencePts));
  return { score, components };
}

export function routeByScore(score: number, t: Thresholds): "high" | "feed" | null {
  if (score >= t.score.high) return "high";
  if (score >= t.score.low) return "feed";
  return null;
}

const round1 = (x: number) => Math.round(x * 10) / 10;
const round2 = (x: number) => Math.round(x * 100) / 100;

/** mean / sample stddev of a list — used by replay and tests to build WalletStats. */
export function statsOf(values: number[]): WalletStats {
  const n = values.length;
  if (n === 0) return { n: 0, mean: null, stddev: null };
  const mean = values.reduce((a, b) => a + b, 0) / n;
  if (n < 2) return { n, mean, stddev: 0 };
  const v = values.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1);
  return { n, mean, stddev: Math.sqrt(v) };
}
