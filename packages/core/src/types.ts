import { z } from "zod";

// ---------------------------------------------------------------- enums

export const EVENT_TYPES = ["OPEN", "CLOSE", "INCREASE", "DECREASE", "FLIP"] as const;
export type EventType = (typeof EVENT_TYPES)[number];
export const EventTypeSchema = z.enum(EVENT_TYPES);

export type Side = "long" | "short";
export type WalletTier = "A" | "B" | "C";
export type CoinTier = "major" | "mid" | "long_tail";
export type ChannelKey = "high" | "feed" | "clusters" | "ops";

// ---------------------------------------------------------------- thresholds (rule engine config)

export const ThresholdsSchema = z.object({
  event_types: z.array(EventTypeSchema).default([...EVENT_TYPES]),
  min_delta_notional_usd: z.number().nonnegative().default(25_000),
  /** INCREASE/DECREASE only: |Δsize| / |s0| * 100 must be >= this */
  min_pct_change: z.number().nonnegative().default(25),
  /** max(prior, new) notional / account value * 100 must be >= this */
  min_equity_pct: z.number().nonnegative().default(2),
  min_leverage: z.number().nonnegative().default(0),
  max_leverage: z.number().positive().default(100),
  coin_whitelist: z.array(z.string()).default([]),
  coin_blacklist: z.array(z.string()).default([]),
  /** CLOSE only: |realized PnL| must be >= this */
  close_min_realized_pnl_usd: z.number().nonnegative().default(5_000),
  /** per wallet+coin, not applied to FLIP/CLOSE */
  cooldown_sec: z.number().nonnegative().default(1800),
  /** ignore if pct change < pct AND Δnotional < usd */
  dust: z.object({ pct: z.number().nonnegative().default(5), usd: z.number().nonnegative().default(2_000) }).default({}),
  mm: z
    .object({ fills_per_day: z.number().positive().default(200), drift_ratio: z.number().min(0).max(1).default(0.1) })
    .default({}),
  score: z.object({ high: z.number().min(0).max(100).default(70), low: z.number().min(0).max(100).default(40) }).default({}),
  cluster: z.object({ k: z.number().int().min(2).default(3), t_min: z.number().positive().default(60) }).default({}),
  agg_window_sec: z.number().positive().default(120),
  /** thread replies with score >= this are also broadcast to the channel */
  thread_broadcast_min_score: z.number().min(0).max(100).default(85),
  /** below this many trailing events, scorer falls back to absolute size scale */
  zscore_min_samples: z.number().int().min(2).default(5),
  /** per-wallet override: do not mute even if auto-flagged as market maker */
  ignore_mm_flag: z.boolean().default(false),
});
export type Thresholds = z.infer<typeof ThresholdsSchema>;
export type PartialThresholds = z.input<typeof ThresholdsSchema>;

export const RoutingSchema = z.object({
  high: z.string().optional(),
  feed: z.string().optional(),
  clusters: z.string().optional(),
  ops: z.string().optional(),
});
export type Routing = z.infer<typeof RoutingSchema>;

// ---------------------------------------------------------------- domain

export interface Wallet {
  id: string;
  address: string;
  label: string;
  tier: WalletTier;
  venue: string;
  isActive: boolean;
  isPriority: boolean;
  muted: boolean;
  overrides: PartialThresholds;
}

export interface AlertRule {
  scope: "global" | "wallet" | "coin_tier";
  scopeRef: string | null;
  eventTypes: EventType[];
  thresholds: PartialThresholds;
  routing: Routing;
  enabled: boolean;
}

/** One coin's state inside a wallet, as returned by the venue adapter. */
export interface PositionState {
  coin: string;
  /** signed size: >0 long, <0 short, 0 flat */
  szi: number;
  entryPx: number | null;
  positionValue: number | null;
  leverage: number | null;
  liqPx: number | null;
  unrealizedPnl: number | null;
  markPx: number | null;
  accountValue: number | null;
}

export interface Fill {
  tid: number;
  hash: string;
  coin: string;
  px: number;
  sz: number;
  side: "B" | "A";
  dir: string;
  startPosition: number;
  closedPnl: number;
  fee: number;
  /** ms epoch */
  time: number;
  /** true = taker */
  crossed: boolean;
}

export interface ScoreComponents {
  size_z: number;
  equity_pct: number;
  tier: number;
  event_type: number;
  confluence: number;
  /** raw inputs for audit */
  z: number | null;
  z_fallback: boolean;
  wallet_mean: number | null;
  wallet_stddev: number | null;
  wallet_n: number;
}

export type FilterReason =
  | "muted"
  | "mm_flagged"
  | "event_type_disabled"
  | "coin_blacklist"
  | "coin_not_whitelisted"
  | "dust"
  | "min_delta_notional"
  | "min_pct_change"
  | "min_equity_pct"
  | "leverage_out_of_range"
  | "close_min_realized_pnl"
  | "cooldown"
  | "below_score_threshold";

/** A classified, enriched position change (before filtering/scoring). */
export interface PositionEvent {
  walletId: string;
  coin: string;
  eventType: EventType;
  side: Side;
  /** ms epoch */
  windowStart: number;
  windowEnd: number;
  s0: number;
  s1: number;
  deltaSize: number;
  deltaNotionalUsd: number;
  /** |Δ| / |s0| * 100; null for OPEN */
  pctChange: number | null;
  newNotionalUsd: number;
  /** max(prior, new) notional / account value * 100 */
  equityPct: number | null;
  leverage: number | null;
  entryPx: number | null;
  avgFillPx: number | null;
  markPx: number | null;
  liqPx: number | null;
  unrealizedPnl: number | null;
  realizedPnl: number | null;
  fillCount: number;
  takerRatio: number | null;
}

export interface Decision {
  filtered: boolean;
  filterReason: FilterReason | null;
  score: number;
  components: ScoreComponents;
  /** "high" | "feed" when alerted, null otherwise */
  channel: "high" | "feed" | null;
}

export interface WalletStats {
  n: number;
  mean: number | null;
  stddev: number | null;
}
