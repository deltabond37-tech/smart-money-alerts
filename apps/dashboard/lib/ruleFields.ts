/** Pure metadata for the rule editor (safe for client components: no @sma/core import). */
/** Flat field list for the rule editor; blank = inherit (or default for the global rule). */
export const NUMBER_FIELDS: Array<{ key: string; label: string; help: string; step?: number }> = [
  { key: "min_delta_notional_usd", label: "Min Δ notional (USD)", help: "Ignore changes smaller than this" },
  { key: "min_pct_change", label: "Min % change", help: "INCREASE/DECREASE only: |Δ| / prior size" },
  { key: "min_equity_pct", label: "Min position % of equity", help: "max(prior,new) notional / account value" },
  { key: "min_leverage", label: "Min leverage" },
  { key: "max_leverage", label: "Max leverage" },
  { key: "close_min_realized_pnl_usd", label: "CLOSE: min |realized PnL| (USD)", help: "Closes below this are logged only" },
  { key: "cooldown_sec", label: "Cooldown (sec)", help: "per wallet+coin; FLIP/CLOSE exempt" },
  { key: "dust.pct", label: "Dust: % change below", help: "dust = below BOTH pct and usd" },
  { key: "dust.usd", label: "Dust: USD below" },
  { key: "mm.fills_per_day", label: "MM flag: fills/day above", help: "AND drift below → auto-mute; 10× → always" },
  { key: "mm.drift_ratio", label: "MM flag: drift ratio below", step: 0.01 },
  { key: "score.high", label: "Score ≥ → high-conviction" },
  { key: "score.low", label: "Score ≥ → feed", help: "below → DB only" },
  { key: "cluster.k", label: "Cluster: min wallets (K)" },
  { key: "cluster.t_min", label: "Cluster: window (minutes)" },
  { key: "agg_window_sec", label: "Aggregation window (sec)", help: "coalesce fills per wallet+coin (global only)" },
  { key: "thread_broadcast_min_score", label: "Thread reply: also send to channel if score ≥" },
  { key: "zscore_min_samples", label: "Z-score: min history samples", help: "below → absolute size fallback" },
].map((f) => ({ help: "", ...f }));

export const getPath = (o: unknown, path: string): unknown => path.split(".").reduce<unknown>((acc, k) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[k] : undefined), o);
