import type { EventType, Side } from "./types.js";

export interface ClusterCandidate {
  eventId: string;
  walletId: string;
  coin: string;
  side: Side;
  eventType: EventType;
  /** ms epoch */
  at: number;
}

export interface Cluster {
  coin: string;
  direction: Side;
  walletIds: string[];
  eventIds: string[];
  windowStart: number;
  windowEnd: number;
}

/**
 * Group OPEN/INCREASE events by coin+direction; any group with >= k distinct wallets whose events
 * all fall inside a tMin-minute span is a cluster. Uses a sliding window anchored at each event so
 * old events outside the span don't count. Dedupe against already-alerted clusters is the caller's job.
 */
export function detectClusters(events: ClusterCandidate[], k: number, tMin: number): Cluster[] {
  const spanMs = tMin * 60_000;
  const groups = new Map<string, ClusterCandidate[]>();
  for (const e of events) {
    if (e.eventType !== "OPEN" && e.eventType !== "INCREASE") continue;
    const key = `${e.coin}|${e.side}`;
    const arr = groups.get(key) ?? [];
    arr.push(e);
    groups.set(key, arr);
  }

  const out: Cluster[] = [];
  for (const arr of groups.values()) {
    arr.sort((a, b) => a.at - b.at);
    let best: Cluster | null = null;
    for (let i = 0; i < arr.length; i++) {
      const anchor = arr[i]!;
      const inSpan = arr.filter((e) => e.at >= anchor.at && e.at - anchor.at <= spanMs);
      const wallets = new Set(inSpan.map((e) => e.walletId));
      if (wallets.size >= k && (!best || wallets.size > best.walletIds.length)) {
        best = {
          coin: anchor.coin,
          direction: anchor.side,
          walletIds: [...wallets],
          eventIds: inSpan.map((e) => e.eventId),
          windowStart: inSpan[0]!.at,
          windowEnd: inSpan[inSpan.length - 1]!.at,
        };
      }
    }
    if (best) out.push(best);
  }
  return out;
}

/** Number of OTHER wallets with same coin+direction OPEN/INCREASE within the span — scorer confluence input. */
export function confluenceCount(events: ClusterCandidate[], walletId: string, coin: string, side: Side, at: number, tMin: number): number {
  const spanMs = tMin * 60_000;
  const others = new Set<string>();
  for (const e of events) {
    if (e.walletId === walletId || e.coin !== coin || e.side !== side) continue;
    if (e.eventType !== "OPEN" && e.eventType !== "INCREASE") continue;
    if (Math.abs(e.at - at) <= spanMs) others.add(e.walletId);
  }
  return others.size;
}
