import type { FilterReason, PositionEvent, Thresholds } from "./types.js";

export interface FilterContext {
  muted: boolean;
  mmFlagged: boolean;
  /** ms epoch of the last *alerted* event for this wallet+coin, if any */
  lastAlertAt: number | null;
}

export interface FilterResult {
  pass: boolean;
  reason: FilterReason | null;
}

const PASS: FilterResult = { pass: true, reason: null };
const fail = (reason: FilterReason): FilterResult => ({ pass: false, reason });

/** Hard filters, evaluated in order. Scoring/routing happens afterwards (see pipeline.ts). */
export function evaluateFilters(ev: PositionEvent, t: Thresholds, ctx: FilterContext): FilterResult {
  if (ctx.muted) return fail("muted");
  if (ctx.mmFlagged && !t.ignore_mm_flag) return fail("mm_flagged");
  if (!t.event_types.includes(ev.eventType)) return fail("event_type_disabled");

  const coin = ev.coin.toUpperCase();
  if (t.coin_blacklist.some((c) => c.toUpperCase() === coin)) return fail("coin_blacklist");
  if (t.coin_whitelist.length > 0 && !t.coin_whitelist.some((c) => c.toUpperCase() === coin)) {
    return fail("coin_not_whitelisted");
  }

  // dust: small in BOTH relative and absolute terms
  const pct = ev.pctChange;
  if (pct !== null && pct < t.dust.pct && ev.deltaNotionalUsd < t.dust.usd) return fail("dust");

  if (ev.deltaNotionalUsd < t.min_delta_notional_usd) return fail("min_delta_notional");

  if ((ev.eventType === "INCREASE" || ev.eventType === "DECREASE") && pct !== null && pct < t.min_pct_change) {
    return fail("min_pct_change");
  }

  if (ev.equityPct !== null && ev.equityPct < t.min_equity_pct) return fail("min_equity_pct");

  if (ev.leverage !== null && (ev.leverage < t.min_leverage || ev.leverage > t.max_leverage)) {
    return fail("leverage_out_of_range");
  }

  if (ev.eventType === "CLOSE" && Math.abs(ev.realizedPnl ?? 0) < t.close_min_realized_pnl_usd) {
    return fail("close_min_realized_pnl");
  }

  const cooldownExempt = ev.eventType === "FLIP" || ev.eventType === "CLOSE";
  if (!cooldownExempt && ctx.lastAlertAt !== null && ev.windowEnd - ctx.lastAlertAt < t.cooldown_sec * 1000) {
    return fail("cooldown");
  }

  return PASS;
}
