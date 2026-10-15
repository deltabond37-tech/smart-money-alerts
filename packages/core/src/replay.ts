import { confluenceCount, type ClusterCandidate } from "./cluster.js";
import { decide } from "./pipeline.js";
import { coinTierOf, resolveRules, type RuleSet } from "./rules.js";
import { statsOf } from "./scorer.js";
import type { Decision, FilterReason, PositionEvent, Wallet } from "./types.js";

export interface ReplayEvent extends PositionEvent {
  id: string;
  mmFlagged?: boolean;
}

export interface ReplayDecision {
  id: string;
  walletId: string;
  coin: string;
  eventType: PositionEvent["eventType"];
  decision: Decision;
}

export interface ReplayResult {
  total: number;
  high: number;
  feed: number;
  filtered: number;
  byReason: Partial<Record<FilterReason, number>>;
  decisions: ReplayDecision[];
}

/**
 * Re-run stored events through a (possibly edited) rule set. Used by the dashboard "Test rule" button.
 * - Events are processed in time order so cooldowns are simulated.
 * - Wallet stats (z-score inputs) are built from the replay set itself, trailing per event.
 * - Confluence uses the replay set as the universe of tracked-wallet activity.
 */
export function replay(events: ReplayEvent[], ruleSet: RuleSet, wallets: Wallet[]): ReplayResult {
  const walletsById = new Map(wallets.map((w) => [w.id, w]));
  const sorted = [...events].sort((a, b) => a.windowEnd - b.windowEnd);
  const candidates: ClusterCandidate[] = sorted.map((e) => ({
    eventId: e.id,
    walletId: e.walletId,
    coin: e.coin,
    side: e.side,
    eventType: e.eventType,
    at: e.windowEnd,
  }));

  const lastAlert = new Map<string, number>();
  const history = new Map<string, number[]>();
  const result: ReplayResult = { total: sorted.length, high: 0, feed: 0, filtered: 0, byReason: {}, decisions: [] };

  for (const ev of sorted) {
    const wallet = walletsById.get(ev.walletId);
    if (!wallet) continue;
    const { thresholds } = resolveRules(ruleSet, wallet, ev.coin);
    const key = `${ev.walletId}:${ev.coin}`;
    const hist = history.get(ev.walletId) ?? [];

    const d = decide(
      ev,
      thresholds,
      { muted: wallet.muted, mmFlagged: ev.mmFlagged ?? false, lastAlertAt: lastAlert.get(key) ?? null },
      {
        walletStats: statsOf(hist),
        walletTier: wallet.tier,
        coinTier: coinTierOf(ev.coin, ruleSet.coinTiers),
        confluenceCount: confluenceCount(candidates, ev.walletId, ev.coin, ev.side, ev.windowEnd, thresholds.cluster.t_min),
      },
    );

    hist.push(Math.abs(ev.deltaNotionalUsd));
    history.set(ev.walletId, hist);

    if (d.filtered) {
      result.filtered++;
      if (d.filterReason) result.byReason[d.filterReason] = (result.byReason[d.filterReason] ?? 0) + 1;
    } else {
      lastAlert.set(key, ev.windowEnd);
      if (d.channel === "high") result.high++;
      else result.feed++;
    }
    result.decisions.push({ id: ev.id, walletId: ev.walletId, coin: ev.coin, eventType: ev.eventType, decision: d });
  }
  return result;
}
