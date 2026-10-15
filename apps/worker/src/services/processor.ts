import {
  classify,
  coinTierOf,
  confluenceCount,
  decide,
  eventKey,
  resolveRules,
  WindowAggregator,
  type FlushedWindow,
  type PositionState,
  type Wallet,
} from "@sma/core";
import type { PositionSourceAdapter, WalletSnapshot } from "../adapters/PositionSourceAdapter.js";
import type { Repo, SnapshotRow, WalletStateRow } from "../db/repo.js";
import { errMsg, type Logger } from "../logger.js";
import type { Alerter } from "./alerter.js";
import type { ConfigLoader } from "./configLoader.js";

const FILLS_LOOKBACK_CAP_MS = 7 * 24 * 3600_000;

const flat = (coin: string, accountValue: number | null, markPx: number | null): PositionState => ({
  coin,
  szi: 0,
  entryPx: null,
  positionValue: 0,
  leverage: null,
  liqPx: null,
  unrealizedPnl: null,
  markPx,
  accountValue,
});

export interface ProcessorDeps {
  repo: Repo;
  config: ConfigLoader;
  alerter: Alerter;
  adapter: PositionSourceAdapter;
  aggregator: WindowAggregator;
  log: Logger;
  now?: () => number;
}

/**
 * Owns the committed-state view (mirrors position_snapshots), feeds the aggregator with live snapshots,
 * and turns flushed windows into classified, filtered, scored, persisted and alerted events.
 */
export class Processor {
  /** walletId -> coin -> committed snapshot */
  readonly committed = new Map<string, Map<string, SnapshotRow>>();
  readonly walletState = new Map<string, WalletStateRow>();
  private readonly lastAlertAt = new Map<string, number>();
  private readonly now: () => number;
  stats = { events: 0, alerted: 0, filtered: 0, duplicates: 0 };

  constructor(private readonly d: ProcessorDeps) {
    this.now = d.now ?? (() => Date.now());
  }

  get aggregator(): WindowAggregator {
    return this.d.aggregator;
  }

  async boot(): Promise<void> {
    const [snaps, states, alerts] = await Promise.all([this.d.repo.loadSnapshots(), this.d.repo.loadWalletStates(), this.d.repo.loadLastAlerts(this.now() - 24 * 3600_000)]);
    for (const s of snaps) this.setCommitted(s);
    for (const st of states) this.walletState.set(st.walletId, st);
    for (const a of alerts) {
      const k = `${a.walletId}:${a.coin}`;
      this.lastAlertAt.set(k, Math.max(this.lastAlertAt.get(k) ?? 0, a.windowEnd));
    }
    this.d.log.info({ snapshots: snaps.length, walletStates: states.length, recentAlerts: alerts.length }, "processor state restored");
  }

  private setCommitted(s: SnapshotRow): void {
    let m = this.committed.get(s.walletId);
    if (!m) {
      m = new Map();
      this.committed.set(s.walletId, m);
    }
    m.set(s.coin, s);
  }

  isKnownWallet(walletId: string): boolean {
    return this.walletState.has(walletId);
  }

  async patchWalletState(walletId: string, patch: Partial<Omit<WalletStateRow, "walletId">>): Promise<void> {
    const cur: WalletStateRow = this.walletState.get(walletId) ?? {
      walletId,
      lastFillTime: 0,
      lastFillsSyncAt: null,
      lastPollAt: null,
      accountValue: null,
      consecutiveErrors: 0,
      lastError: null,
      autoFlags: {},
    };
    this.walletState.set(walletId, { ...cur, ...patch });
    await this.d.repo.upsertWalletState(walletId, patch);
  }

  /**
   * Compare a live snapshot against committed state. New wallets are baselined (no events).
   * Changed coins open/extend aggregation windows.
   */
  async handleSnapshot(wallet: Wallet, snap: WalletSnapshot, now: number): Promise<void> {
    const live = new Map(snap.positions.map((p) => [p.coin, p]));
    const committed = this.committed.get(wallet.id) ?? new Map<string, SnapshotRow>();

    if (!this.isKnownWallet(wallet.id)) {
      const rows: SnapshotRow[] = snap.positions.map((p) => ({ walletId: wallet.id, coin: p.coin, state: p, committedAt: now }));
      await this.d.repo.upsertSnapshots(rows);
      for (const r of rows) this.setCommitted(r);
      await this.patchWalletState(wallet.id, { lastPollAt: now, accountValue: snap.accountValue, lastFillTime: now });
      this.d.log.info({ wallet: wallet.label, positions: rows.length }, "new wallet baselined (no events for pre-existing positions)");
      return;
    }

    const coins = new Set<string>([...live.keys(), ...committed.keys()]);
    for (const coin of coins) {
      const base = committed.get(coin)?.state ?? flat(coin, snap.accountValue, live.get(coin)?.markPx ?? null);
      const cur = live.get(coin) ?? flat(coin, snap.accountValue, committed.get(coin)?.state.markPx ?? null);
      this.d.aggregator.observe(wallet.id, coin, base, cur, now);
    }
    await this.patchWalletState(wallet.id, { lastPollAt: now, accountValue: snap.accountValue, consecutiveErrors: 0, lastError: null });
  }

  /** Flush windows whose duration has elapsed and process each one. Errors are isolated per window. */
  async flushAndProcess(now: number): Promise<number> {
    const windows = this.d.aggregator.flushExpired(now);
    for (const w of windows) {
      try {
        await this.processWindow(w);
      } catch (e) {
        this.d.log.error({ err: errMsg(e), wallet: w.walletId, coin: w.coin }, "window processing failed; window dropped (will be re-derived from snapshot)");
      }
    }
    return windows.length;
  }

  async processWindow(w: FlushedWindow): Promise<void> {
    const { repo, config, alerter, adapter, log } = this.d;
    const wallet = config.walletById(w.walletId);
    if (!wallet) return;

    // fills since the last committed state (covers restarts where the window start is "now")
    const committedAt = this.committed.get(w.walletId)?.get(w.coin)?.committedAt ?? w.windowStart;
    const from = Math.max(Math.min(w.windowStart, committedAt), w.windowEnd - FILLS_LOOKBACK_CAP_MS);
    let fills = [] as Awaited<ReturnType<PositionSourceAdapter["getFills"]>>;
    try {
      fills = await adapter.getFills(wallet.address, from, w.windowEnd);
      if (fills.length) {
        await repo.insertFills(wallet.id, fills);
        const maxT = Math.max(...fills.map((f) => f.time));
        const st = this.walletState.get(wallet.id);
        if (!st || maxT > st.lastFillTime) await this.patchWalletState(wallet.id, { lastFillTime: maxT });
      }
    } catch (e) {
      log.warn({ err: errMsg(e), wallet: wallet.label }, "fills fetch failed; classifying without fill enrichment");
    }

    const ev = classify({ walletId: wallet.id, coin: w.coin, prev: w.prev, next: w.next, windowStart: w.windowStart, windowEnd: w.windowEnd, fills });
    if (!ev) {
      log.debug({ wallet: wallet.label, coin: w.coin }, "net-zero window; no event");
      return;
    }

    const { thresholds, routing } = resolveRules(config.current, wallet, w.coin);
    const key = `${wallet.id}:${w.coin}`;
    const state = this.walletState.get(wallet.id);
    const [walletStats, candidates] = await Promise.all([
      repo.walletStats(wallet.id, 30),
      ev.eventType === "OPEN" || ev.eventType === "INCREASE" ? repo.clusterCandidates(ev.windowEnd - thresholds.cluster.t_min * 60_000) : Promise.resolve([]),
    ]);
    const decision = decide(
      ev,
      thresholds,
      { muted: wallet.muted, mmFlagged: state?.autoFlags?.mm === true, lastAlertAt: this.lastAlertAt.get(key) ?? null },
      {
        walletStats,
        walletTier: wallet.tier,
        coinTier: coinTierOf(w.coin, config.current.coinTiers),
        confluenceCount: confluenceCount(candidates, wallet.id, w.coin, ev.side, ev.windowEnd, thresholds.cluster.t_min),
      },
    );

    const snapshot: SnapshotRow = { walletId: wallet.id, coin: w.coin, state: w.next, committedAt: w.windowEnd };
    const channel = decision.channel ? alerter.resolveChannel(decision.channel, routing) : null;
    const eventId = await repo.commitEvent({ eventKey: eventKey(wallet.id, w.coin, w.windowEnd, ev.s0, ev.s1), event: ev, decision, channel, lifecycleId: null }, snapshot);
    if (!eventId) {
      this.stats.duplicates++;
      log.warn({ wallet: wallet.label, coin: w.coin }, "duplicate event key; skipped");
      this.setCommitted(snapshot);
      return;
    }
    this.setCommitted(snapshot);
    this.stats.events++;

    if (decision.filtered) {
      this.stats.filtered++;
      log.info({ eventId, wallet: wallet.label, coin: w.coin, type: ev.eventType, reason: decision.filterReason, score: decision.score, deltaUsd: Math.round(ev.deltaNotionalUsd) }, "event filtered");
      if (ev.eventType === "CLOSE" || ev.eventType === "FLIP") await alerter.closeLifecycle(wallet.id, w.coin);
      return;
    }

    this.stats.alerted++;
    this.lastAlertAt.set(key, ev.windowEnd);
    try {
      await alerter.postEvent({ eventId, event: ev, wallet, decision, thresholds, routing });
    } catch (e) {
      log.error({ err: errMsg(e), eventId }, "alert post failed (recorded in alerts_sent)");
    }
    try {
      const walletsById = new Map(config.current.wallets.map((x) => [x.id, x]));
      await alerter.checkCluster({ eventId, event: ev, wallet, thresholds, routing, walletsById });
    } catch (e) {
      log.error({ err: errMsg(e), eventId }, "cluster check failed");
    }
  }
}
