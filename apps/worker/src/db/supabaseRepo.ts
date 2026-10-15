import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { AlertRule, ClusterCandidate, CoinTier, Fill, PositionState, Wallet, WalletStats } from "@sma/core";
import type {
  AlertRow,
  ClusterRow,
  ConfigBundle,
  EventInsert,
  HeartbeatRow,
  Repo,
  SnapshotRow,
  StoredEvent,
  ThreadRow,
  WalletStateRow,
} from "./repo.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>;

const n = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const ms = (v: unknown): number | null => (v ? new Date(v as string).getTime() : null);
const iso = (t: number): string => new Date(t).toISOString();

export function createSupabase(url: string, serviceRoleKey: string): SupabaseClient {
  return createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

export function rowToEvent(r: Row): StoredEvent {
  return {
    id: r.id,
    walletId: r.wallet_id,
    coin: r.coin,
    eventType: r.event_type,
    side: r.side,
    windowStart: ms(r.window_start)!,
    windowEnd: ms(r.window_end)!,
    s0: Number(r.s0),
    s1: Number(r.s1),
    deltaSize: Number(r.delta_size),
    deltaNotionalUsd: Number(r.delta_notional_usd),
    pctChange: n(r.pct_change),
    newNotionalUsd: Number(r.new_notional_usd),
    equityPct: n(r.equity_pct),
    leverage: n(r.leverage),
    entryPx: n(r.entry_px),
    avgFillPx: n(r.avg_fill_px),
    markPx: n(r.mark_px),
    liqPx: n(r.liq_px),
    unrealizedPnl: n(r.unrealized_pnl),
    realizedPnl: n(r.realized_pnl),
    fillCount: Number(r.fill_count ?? 0),
    takerRatio: n(r.taker_ratio),
    score: Number(r.score ?? 0),
    filtered: Boolean(r.filtered),
    filterReason: r.filter_reason ?? null,
    channel: r.channel ?? null,
    lifecycleId: r.lifecycle_id ?? null,
    components: r.score_components ?? {},
    createdAt: ms(r.created_at)!,
  };
}

const threadFromRow = (r: Row): ThreadRow => ({
  lifecycleId: r.lifecycle_id,
  walletId: r.wallet_id,
  coin: r.coin,
  channel: r.channel,
  threadTs: r.thread_ts,
  openedAt: ms(r.opened_at)!,
  closedAt: ms(r.closed_at),
});

const alertFromRow = (r: Row): AlertRow => ({
  id: r.id,
  eventId: r.event_id ?? null,
  clusterId: r.cluster_id ?? null,
  channel: r.channel,
  ts: r.ts ?? null,
  threadTs: r.thread_ts ?? null,
  status: r.status,
  error: r.error ?? null,
  attempts: Number(r.attempts ?? 0),
});

const clusterFromRow = (r: Row): ClusterRow => ({
  id: r.id,
  coin: r.coin,
  direction: r.direction,
  windowStart: ms(r.window_start)!,
  windowEnd: ms(r.window_end)!,
  walletIds: r.wallet_ids ?? [],
  eventIds: r.event_ids ?? [],
  channel: r.channel ?? null,
  threadTs: r.thread_ts ?? null,
});

function must<T>(res: { data: T; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data;
}

export class SupabaseRepo implements Repo {
  constructor(private readonly sb: SupabaseClient) {}

  async loadConfig(): Promise<ConfigBundle> {
    const [w, r, c] = await Promise.all([
      this.sb.from("wallets").select("*").order("created_at"),
      this.sb.from("alert_rules").select("*"),
      this.sb.from("coin_tiers").select("coin,tier"),
    ]);
    const wallets: Wallet[] = (must(w, "wallets") as Row[]).map((x) => ({
      id: x.id,
      address: String(x.address).toLowerCase(),
      label: x.label,
      tier: x.tier,
      venue: x.venue,
      isActive: Boolean(x.is_active),
      isPriority: Boolean(x.is_priority),
      muted: Boolean(x.muted),
      overrides: x.overrides ?? {},
    }));
    const rules: AlertRule[] = (must(r, "alert_rules") as Row[]).map((x) => ({
      scope: x.scope,
      scopeRef: x.scope_ref ?? null,
      eventTypes: x.event_types ?? [],
      thresholds: x.thresholds ?? {},
      routing: x.routing ?? {},
      enabled: Boolean(x.enabled),
    }));
    const coinTiers: Record<string, CoinTier> = {};
    for (const x of must(c, "coin_tiers") as Row[]) coinTiers[x.coin] = x.tier;
    return { wallets, rules, coinTiers };
  }

  async loadSnapshots(): Promise<SnapshotRow[]> {
    const rows = must(await this.sb.from("position_snapshots").select("*"), "position_snapshots") as Row[];
    return rows.map((r) => ({
      walletId: r.wallet_id,
      coin: r.coin,
      committedAt: ms(r.committed_at)!,
      state: {
        coin: r.coin,
        szi: Number(r.szi),
        entryPx: n(r.entry_px),
        positionValue: n(r.position_value),
        leverage: n(r.leverage),
        liqPx: n(r.liq_px),
        unrealizedPnl: n(r.unrealized_pnl),
        markPx: n(r.mark_px),
        accountValue: n(r.account_value),
      },
    }));
  }

  private snapshotToRow(s: SnapshotRow): Row {
    const p: PositionState = s.state;
    return {
      wallet_id: s.walletId,
      coin: s.coin,
      szi: p.szi,
      entry_px: p.entryPx,
      position_value: p.positionValue,
      leverage: p.leverage,
      liq_px: p.liqPx,
      unrealized_pnl: p.unrealizedPnl,
      mark_px: p.markPx,
      account_value: p.accountValue,
    };
  }

  async upsertSnapshots(rows: SnapshotRow[]): Promise<void> {
    if (rows.length === 0) return;
    must(
      await this.sb.from("position_snapshots").upsert(
        rows.map((s) => ({ ...this.snapshotToRow(s), committed_at: iso(s.committedAt) })),
        { onConflict: "wallet_id,coin" },
      ),
      "upsert snapshots",
    );
  }

  async loadWalletStates(): Promise<WalletStateRow[]> {
    const rows = must(await this.sb.from("wallet_state").select("*"), "wallet_state") as Row[];
    return rows.map((r) => ({
      walletId: r.wallet_id,
      lastFillTime: Number(r.last_fill_time ?? 0),
      lastFillsSyncAt: ms(r.last_fills_sync_at),
      lastPollAt: ms(r.last_poll_at),
      accountValue: n(r.account_value),
      consecutiveErrors: Number(r.consecutive_errors ?? 0),
      lastError: r.last_error ?? null,
      autoFlags: r.auto_flags ?? {},
    }));
  }

  async upsertWalletState(walletId: string, patch: Partial<Omit<WalletStateRow, "walletId">>): Promise<void> {
    const row: Row = { wallet_id: walletId };
    if (patch.lastFillTime !== undefined) row.last_fill_time = patch.lastFillTime;
    if (patch.lastFillsSyncAt !== undefined) row.last_fills_sync_at = patch.lastFillsSyncAt === null ? null : iso(patch.lastFillsSyncAt);
    if (patch.lastPollAt !== undefined) row.last_poll_at = patch.lastPollAt === null ? null : iso(patch.lastPollAt);
    if (patch.accountValue !== undefined) row.account_value = patch.accountValue;
    if (patch.consecutiveErrors !== undefined) row.consecutive_errors = patch.consecutiveErrors;
    if (patch.lastError !== undefined) row.last_error = patch.lastError;
    if (patch.autoFlags !== undefined) row.auto_flags = patch.autoFlags;
    must(await this.sb.from("wallet_state").upsert(row, { onConflict: "wallet_id" }), "upsert wallet_state");
  }

  async commitEvent(ins: EventInsert, snapshot: SnapshotRow): Promise<string | null> {
    const e = ins.event;
    const p_event = {
      event_key: ins.eventKey,
      wallet_id: e.walletId,
      coin: e.coin,
      event_type: e.eventType,
      side: e.side,
      window_start: iso(e.windowStart),
      window_end: iso(e.windowEnd),
      s0: e.s0,
      s1: e.s1,
      delta_size: e.deltaSize,
      delta_notional_usd: e.deltaNotionalUsd,
      pct_change: e.pctChange,
      new_notional_usd: e.newNotionalUsd,
      equity_pct: e.equityPct,
      leverage: e.leverage,
      entry_px: e.entryPx,
      avg_fill_px: e.avgFillPx,
      mark_px: e.markPx,
      liq_px: e.liqPx,
      unrealized_pnl: e.unrealizedPnl,
      realized_pnl: e.realizedPnl,
      fill_count: e.fillCount,
      taker_ratio: e.takerRatio,
      score: ins.decision.score,
      score_components: ins.decision.components,
      filtered: ins.decision.filtered,
      filter_reason: ins.decision.filterReason,
      channel: ins.channel,
      lifecycle_id: ins.lifecycleId,
    };
    const res = await this.sb.rpc("commit_position_event", { p_event, p_snapshot: this.snapshotToRow(snapshot) });
    const id = must(res, "commit_position_event") as string | null;
    return id ?? null;
  }

  async setEventLifecycle(eventId: string, lifecycleId: string): Promise<void> {
    must(await this.sb.from("position_events").update({ lifecycle_id: lifecycleId }).eq("id", eventId), "set lifecycle");
  }

  async getEvent(eventId: string): Promise<StoredEvent | null> {
    const res = await this.sb.from("position_events").select("*").eq("id", eventId).maybeSingle();
    const row = must(res, "get event") as Row | null;
    return row ? rowToEvent(row) : null;
  }

  async walletStats(walletId: string, days = 30): Promise<WalletStats> {
    const res = await this.sb.rpc("wallet_event_stats", { p_wallet_id: walletId, p_days: days });
    const rows = must(res, "wallet_event_stats") as Row[];
    const r = rows[0];
    if (!r) return { n: 0, mean: null, stddev: null };
    return { n: Number(r.n ?? 0), mean: n(r.mean), stddev: n(r.stddev) };
  }

  async loadLastAlerts(sinceMs: number): Promise<Array<{ walletId: string; coin: string; windowEnd: number }>> {
    const res = await this.sb
      .from("position_events")
      .select("wallet_id,coin,window_end")
      .eq("filtered", false)
      .gte("window_end", iso(sinceMs));
    return (must(res, "last alerts") as Row[]).map((r) => ({ walletId: r.wallet_id, coin: r.coin, windowEnd: ms(r.window_end)! }));
  }

  async clusterCandidates(sinceMs: number): Promise<ClusterCandidate[]> {
    const res = await this.sb
      .from("position_events")
      .select("id,wallet_id,coin,side,event_type,window_end,filter_reason")
      .in("event_type", ["OPEN", "INCREASE"])
      .gte("window_end", iso(sinceMs));
    return (must(res, "cluster candidates") as Row[])
      .filter((r) => !["dust", "mm_flagged", "muted", "coin_blacklist", "coin_not_whitelisted"].includes(r.filter_reason ?? ""))
      .map((r) => ({ eventId: r.id, walletId: r.wallet_id, coin: r.coin, side: r.side, eventType: r.event_type, at: ms(r.window_end)! }));
  }

  async getOpenThread(walletId: string, coin: string): Promise<ThreadRow | null> {
    const res = await this.sb.from("position_threads").select("*").eq("wallet_id", walletId).eq("coin", coin).is("closed_at", null).maybeSingle();
    const row = must(res, "open thread") as Row | null;
    return row ? threadFromRow(row) : null;
  }

  async createThread(row: Omit<ThreadRow, "lifecycleId" | "closedAt">): Promise<ThreadRow> {
    const res = await this.sb
      .from("position_threads")
      .insert({ wallet_id: row.walletId, coin: row.coin, channel: row.channel, thread_ts: row.threadTs, opened_at: iso(row.openedAt) })
      .select("*")
      .single();
    return threadFromRow(must(res, "create thread") as Row);
  }

  async closeThread(lifecycleId: string, closedAt: number): Promise<void> {
    must(await this.sb.from("position_threads").update({ closed_at: iso(closedAt) }).eq("lifecycle_id", lifecycleId), "close thread");
  }

  async createAlert(row: Pick<AlertRow, "eventId" | "clusterId" | "channel">): Promise<AlertRow> {
    const res = await this.sb
      .from("alerts_sent")
      .insert({ event_id: row.eventId, cluster_id: row.clusterId, channel: row.channel, status: "pending" })
      .select("*")
      .single();
    return alertFromRow(must(res, "create alert") as Row);
  }

  async updateAlert(id: string, patch: Partial<AlertRow> & { sentAt?: number }): Promise<void> {
    const row: Row = {};
    if (patch.status) row.status = patch.status;
    if (patch.ts !== undefined) row.ts = patch.ts;
    if (patch.threadTs !== undefined) row.thread_ts = patch.threadTs;
    if (patch.error !== undefined) row.error = patch.error;
    if (patch.attempts !== undefined) row.attempts = patch.attempts;
    if (patch.sentAt !== undefined) row.sent_at = iso(patch.sentAt);
    must(await this.sb.from("alerts_sent").update(row).eq("id", id), "update alert");
  }

  async listAlertsByStatus(status: AlertRow["status"]): Promise<AlertRow[]> {
    const res = await this.sb.from("alerts_sent").select("*").eq("status", status).order("created_at");
    return (must(res, "list alerts") as Row[]).map(alertFromRow);
  }

  async findActiveCluster(coin: string, direction: "long" | "short", sinceMs: number): Promise<ClusterRow | null> {
    const res = await this.sb
      .from("cluster_alerts")
      .select("*")
      .eq("coin", coin)
      .eq("direction", direction)
      .gte("window_end", iso(sinceMs))
      .order("window_end", { ascending: false })
      .limit(1)
      .maybeSingle();
    const row = must(res, "find cluster") as Row | null;
    return row ? clusterFromRow(row) : null;
  }

  async createCluster(row: Omit<ClusterRow, "id">): Promise<ClusterRow> {
    const res = await this.sb
      .from("cluster_alerts")
      .insert({
        coin: row.coin,
        direction: row.direction,
        window_start: iso(row.windowStart),
        window_end: iso(row.windowEnd),
        wallet_ids: row.walletIds,
        event_ids: row.eventIds,
        channel: row.channel,
        thread_ts: row.threadTs,
      })
      .select("*")
      .single();
    return clusterFromRow(must(res, "create cluster") as Row);
  }

  async updateCluster(id: string, patch: Partial<Omit<ClusterRow, "id">>): Promise<void> {
    const row: Row = {};
    if (patch.windowEnd !== undefined) row.window_end = iso(patch.windowEnd);
    if (patch.walletIds !== undefined) row.wallet_ids = patch.walletIds;
    if (patch.eventIds !== undefined) row.event_ids = patch.eventIds;
    if (patch.channel !== undefined) row.channel = patch.channel;
    if (patch.threadTs !== undefined) row.thread_ts = patch.threadTs;
    must(await this.sb.from("cluster_alerts").update(row).eq("id", id), "update cluster");
  }

  async insertFills(walletId: string, fills: Fill[]): Promise<number> {
    if (fills.length === 0) return 0;
    const rows = fills.map((f) => ({
      wallet_id: walletId,
      tid: f.tid,
      hash: f.hash,
      coin: f.coin,
      px: f.px,
      sz: f.sz,
      side: f.side,
      dir: f.dir,
      start_position: f.startPosition,
      closed_pnl: f.closedPnl,
      fee: f.fee,
      time: f.time,
      crossed: f.crossed,
    }));
    for (let i = 0; i < rows.length; i += 500) {
      must(await this.sb.from("fills").upsert(rows.slice(i, i + 500), { onConflict: "wallet_id,tid", ignoreDuplicates: true }), "insert fills");
    }
    return rows.length;
  }

  async fillsSince(walletId: string, sinceMs: number): Promise<Fill[]> {
    const res = await this.sb.from("fills").select("*").eq("wallet_id", walletId).gte("time", sinceMs).order("time").limit(10_000);
    return (must(res, "fills since") as Row[]).map((r) => ({
      tid: Number(r.tid),
      hash: r.hash ?? "",
      coin: r.coin,
      px: Number(r.px),
      sz: Number(r.sz),
      side: r.side,
      dir: r.dir ?? "",
      startPosition: Number(r.start_position ?? 0),
      closedPnl: Number(r.closed_pnl ?? 0),
      fee: Number(r.fee ?? 0),
      time: Number(r.time),
      crossed: Boolean(r.crossed),
    }));
  }

  async heartbeat(row: HeartbeatRow): Promise<void> {
    must(
      await this.sb.from("worker_heartbeats").upsert(
        {
          worker_id: row.workerId,
          last_loop_at: iso(row.lastLoopAt),
          loop_ms: row.loopMs,
          interval_sec: row.intervalSec,
          wallets_polled: row.walletsPolled,
          budget_used_per_min: row.budgetUsedPerMin,
          errors_1h: row.errors1h,
          version: row.version,
          dry_run: row.dryRun,
          updated_at: iso(Date.now()),
        },
        { onConflict: "worker_id" },
      ),
      "heartbeat",
    );
  }

  async prune(days: number): Promise<{ fills: number; snapshots: number; heartbeats: number }> {
    const rows = must(await this.sb.rpc("prune_old_data", { p_days: days }), "prune") as Row[];
    const r = rows[0] ?? {};
    return { fills: Number(r.fills_deleted ?? 0), snapshots: Number(r.snapshots_deleted ?? 0), heartbeats: Number(r.heartbeats_deleted ?? 0) };
  }
}
