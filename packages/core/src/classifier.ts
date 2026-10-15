import type { EventType, Fill, PositionEvent, PositionState, Side } from "./types.js";

const EPS = 1e-12;

export function isFlat(szi: number): boolean {
  return Math.abs(szi) < EPS;
}

export function sameSize(a: number, b: number): boolean {
  return Math.abs(a - b) < EPS;
}

export function classifyType(s0: number, s1: number): EventType | null {
  if (sameSize(s0, s1)) return null;
  const f0 = isFlat(s0);
  const f1 = isFlat(s1);
  if (f0 && !f1) return "OPEN";
  if (!f0 && f1) return "CLOSE";
  if (Math.sign(s0) !== Math.sign(s1)) return "FLIP";
  return Math.abs(s1) > Math.abs(s0) ? "INCREASE" : "DECREASE";
}

export function sideOf(szi: number): Side {
  return szi >= 0 ? "long" : "short";
}

export interface ClassifyInput {
  walletId: string;
  coin: string;
  /** committed state at window start (szi = s0) */
  prev: PositionState;
  /** live state at window end (szi = s1) */
  next: PositionState;
  windowStart: number;
  windowEnd: number;
  /** fills for this coin within the window (optional enrichment) */
  fills?: Fill[];
}

export interface FillSummary {
  avgPx: number | null;
  realizedPnl: number;
  count: number;
  takerRatio: number | null;
  sumSz: number;
}

export function summarizeFills(fills: Fill[]): FillSummary {
  if (fills.length === 0) return { avgPx: null, realizedPnl: 0, count: 0, takerRatio: null, sumSz: 0 };
  let notional = 0;
  let sumSz = 0;
  let pnl = 0;
  let takers = 0;
  for (const f of fills) {
    notional += f.px * f.sz;
    sumSz += f.sz;
    pnl += f.closedPnl;
    if (f.crossed) takers++;
  }
  return {
    avgPx: sumSz > 0 ? notional / sumSz : null,
    realizedPnl: pnl,
    count: fills.length,
    takerRatio: takers / fills.length,
    sumSz,
  };
}

/**
 * Classify the net change s0 -> s1 for one wallet+coin and compute all derived metrics.
 * Returns null when there is no net size change (e.g. a round trip inside one window).
 */
export function classify(input: ClassifyInput): PositionEvent | null {
  const s0 = input.prev.szi;
  const s1 = input.next.szi;
  const eventType = classifyType(s0, s1);
  if (!eventType) return null;

  const fills = (input.fills ?? []).filter((f) => f.coin === input.coin);
  const fs = summarizeFills(fills);

  const markPx = input.next.markPx ?? input.prev.markPx ?? null;
  // Price used for Δnotional: average fill price if we have fills, else mark price, else entry.
  const deltaPx = fs.avgPx ?? markPx ?? input.next.entryPx ?? input.prev.entryPx ?? 0;
  const deltaSize = s1 - s0;
  const absDelta = Math.abs(deltaSize);
  const deltaNotionalUsd = absDelta * deltaPx;

  const newPx = markPx ?? input.next.entryPx ?? deltaPx;
  const newNotionalUsd = Math.abs(s1) * newPx;
  const priorNotionalUsd = Math.abs(s0) * (markPx ?? input.prev.entryPx ?? deltaPx);

  const accountValue = input.next.accountValue ?? input.prev.accountValue ?? null;
  const equityPct =
    accountValue && accountValue > 0 ? (Math.max(newNotionalUsd, priorNotionalUsd) / accountValue) * 100 : null;

  const pctChange = isFlat(s0) ? null : (absDelta / Math.abs(s0)) * 100;

  const side: Side = eventType === "CLOSE" ? sideOf(s0) : sideOf(s1);

  const isReduce = eventType === "CLOSE" || eventType === "DECREASE" || eventType === "FLIP";

  return {
    walletId: input.walletId,
    coin: input.coin,
    eventType,
    side,
    windowStart: input.windowStart,
    windowEnd: input.windowEnd,
    s0,
    s1,
    deltaSize,
    deltaNotionalUsd,
    pctChange,
    newNotionalUsd,
    equityPct,
    leverage: eventType === "CLOSE" ? input.prev.leverage : (input.next.leverage ?? input.prev.leverage),
    entryPx: eventType === "CLOSE" ? input.prev.entryPx : input.next.entryPx,
    avgFillPx: fs.avgPx,
    markPx,
    liqPx: eventType === "CLOSE" ? null : input.next.liqPx,
    unrealizedPnl: eventType === "CLOSE" ? null : input.next.unrealizedPnl,
    realizedPnl: isReduce ? fs.realizedPnl : fills.length > 0 ? fs.realizedPnl : null,
    fillCount: fs.count,
    takerRatio: fs.takerRatio,
  };
}
