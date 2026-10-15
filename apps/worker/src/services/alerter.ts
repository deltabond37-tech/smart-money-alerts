import {
  detectClusters,
  formatClusterJoinReply,
  formatClusterMessage,
  formatEventMessage,
  formatOpsMessage,
  type Decision,
  type PositionEvent,
  type Routing,
  type Thresholds,
  type Wallet,
} from "@sma/core";
import type { Repo, StoredEvent, ThreadRow } from "../db/repo.js";
import { errMsg, type Logger } from "../logger.js";
import { isDryTs, type SlackPoster } from "./slack.js";

export type Channels = Record<"high" | "feed" | "clusters" | "ops", string>;

export interface AlerterDeps {
  repo: Repo;
  slack: SlackPoster;
  channels: Channels;
  log: Logger;
  timeZone: string;
  now?: () => number;
}

/**
 * Posts alerts to Slack and maintains position lifecycles (threads) and cluster threads.
 * Threading rules:
 *  - OPEN/FLIP start a new lifecycle (closing any still-open one for wallet+coin) and post top-level.
 *  - INCREASE/DECREASE/CLOSE reply in the open lifecycle thread; CLOSE then closes it.
 *  - A reply with score >= thread_broadcast_min_score is also broadcast to the channel.
 *  - If no lifecycle exists (e.g. the OPEN was filtered), the event posts top-level and starts one.
 */
export class Alerter {
  private readonly now: () => number;
  constructor(private readonly d: AlerterDeps) {
    this.now = d.now ?? (() => Date.now());
  }

  resolveChannel(key: "high" | "feed" | "clusters" | "ops", routing: Routing = {}): string {
    return routing[key] ?? this.d.channels[key];
  }

  /** Close any open lifecycle for wallet+coin (used for filtered CLOSE/FLIP so the next OPEN starts clean). */
  async closeLifecycle(walletId: string, coin: string): Promise<void> {
    const t = await this.d.repo.getOpenThread(walletId, coin);
    if (t) await this.d.repo.closeThread(t.lifecycleId, this.now());
  }

  async postEvent(args: {
    eventId: string;
    event: PositionEvent;
    wallet: Wallet;
    decision: Decision;
    thresholds: Thresholds;
    routing: Routing;
  }): Promise<{ ts: string; lifecycleId: string | null } | null> {
    const { repo, slack, log } = this.d;
    const { eventId, event, wallet, decision, thresholds, routing } = args;
    if (decision.filtered || !decision.channel) return null;

    let thread: ThreadRow | null = await repo.getOpenThread(wallet.id, event.coin);
    // A thread created in dry-run has a fake ts; it can't be replied to for real.
    if (thread && isDryTs(thread.threadTs) && !slack.dryRun) {
      await repo.closeThread(thread.lifecycleId, this.now());
      thread = null;
    }
    const startsLifecycle = event.eventType === "OPEN" || event.eventType === "FLIP";
    if (startsLifecycle && thread) {
      await repo.closeThread(thread.lifecycleId, this.now());
      thread = null;
    }

    const topChannel = this.resolveChannel(decision.channel, routing);
    const channel = thread ? thread.channel : topChannel;
    const msg = formatEventMessage({ event, wallet, decision, isThreadReply: !!thread }, { timeZone: this.d.timeZone });

    const alert = await repo.createAlert({ eventId, clusterId: null, channel });
    await repo.updateAlert(alert.id, { status: "posting", attempts: 1 });
    let ts: string;
    try {
      const res = await slack.post(channel, msg, thread ? { threadTs: thread.threadTs, replyBroadcast: decision.score >= thresholds.thread_broadcast_min_score } : {});
      ts = res.ts;
      await repo.updateAlert(alert.id, { status: "sent", ts, threadTs: thread?.threadTs ?? null, sentAt: this.now() });
    } catch (e) {
      await repo.updateAlert(alert.id, { status: "failed", error: errMsg(e) });
      throw e;
    }

    let lifecycleId: string | null = thread?.lifecycleId ?? null;
    if (!thread && event.eventType !== "CLOSE") {
      const created = await repo.createThread({ walletId: wallet.id, coin: event.coin, channel, threadTs: ts, openedAt: this.now() });
      lifecycleId = created.lifecycleId;
    }
    if (lifecycleId) await repo.setEventLifecycle(eventId, lifecycleId);
    if (event.eventType === "CLOSE" && thread) await repo.closeThread(thread.lifecycleId, this.now());

    log.info({ eventId, type: event.eventType, coin: event.coin, wallet: wallet.label, score: decision.score, channel, thread: thread?.threadTs ?? null }, "alert posted");
    return { ts, lifecycleId };
  }

  /**
   * After an OPEN/INCREASE event is committed: look for a K-of-N cluster on this coin+direction.
   * Creates a cluster alert (own channel + thread) or appends a late joiner as a thread reply.
   */
  async checkCluster(args: { eventId: string; event: PositionEvent; wallet: Wallet; thresholds: Thresholds; routing: Routing; walletsById: Map<string, Wallet> }): Promise<void> {
    const { repo, slack, log } = this.d;
    const { event, wallet, thresholds } = args;
    if (event.eventType !== "OPEN" && event.eventType !== "INCREASE") return;
    const { k, t_min } = thresholds.cluster;
    const since = this.now() - t_min * 60_000;
    const candidates = await repo.clusterCandidates(since);
    const clusters = detectClusters(candidates, k, t_min).filter((c) => c.coin === event.coin && c.direction === event.side && c.walletIds.includes(wallet.id));
    const cluster = clusters[0];
    if (!cluster) return;

    const channel = this.resolveChannel("clusters", args.routing);
    const existing = await repo.findActiveCluster(event.coin, event.side, since);
    const walletsFor = (ids: string[]) => ids.map((id) => args.walletsById.get(id)).filter((w): w is Wallet => !!w);

    if (!existing || (isDryTs(existing.threadTs) && !slack.dryRun)) {
      const row = await repo.createCluster({ ...cluster, channel, threadTs: null });
      const alert = await repo.createAlert({ eventId: null, clusterId: row.id, channel });
      await repo.updateAlert(alert.id, { status: "posting", attempts: 1 });
      try {
        const res = await slack.post(channel, formatClusterMessage({ cluster, wallets: walletsFor(cluster.walletIds), k, tMin: t_min }, { timeZone: this.d.timeZone }));
        await repo.updateCluster(row.id, { threadTs: res.ts });
        await repo.updateAlert(alert.id, { status: "sent", ts: res.ts, sentAt: this.now() });
        log.info({ coin: event.coin, direction: event.side, wallets: cluster.walletIds.length }, "cluster alert posted");
      } catch (e) {
        await repo.updateAlert(alert.id, { status: "failed", error: errMsg(e) });
        throw e;
      }
      return;
    }

    if (existing.walletIds.includes(wallet.id)) return;
    const walletIds = [...existing.walletIds, wallet.id];
    const eventIds = [...new Set([...existing.eventIds, ...cluster.eventIds])];
    await repo.updateCluster(existing.id, { walletIds, eventIds, windowEnd: Math.max(existing.windowEnd, event.windowEnd) });
    if (existing.threadTs) {
      const alert = await repo.createAlert({ eventId: null, clusterId: existing.id, channel: existing.channel ?? channel });
      await repo.updateAlert(alert.id, { status: "posting", attempts: 1 });
      try {
        const res = await slack.post(existing.channel ?? channel, formatClusterJoinReply(wallet, event.side, event.coin, event.deltaNotionalUsd), { threadTs: existing.threadTs, replyBroadcast: true });
        await repo.updateAlert(alert.id, { status: "sent", ts: res.ts, threadTs: existing.threadTs, sentAt: this.now() });
      } catch (e) {
        await repo.updateAlert(alert.id, { status: "failed", error: errMsg(e) });
        throw e;
      }
    }
  }

  async postOps(level: "info" | "warn" | "error", title: string, details: Record<string, unknown> = {}): Promise<void> {
    try {
      await this.d.slack.post(this.d.channels.ops, formatOpsMessage(level, title, details));
    } catch (e) {
      this.d.log.error({ err: errMsg(e) }, "ops post failed");
    }
  }

  /**
   * Boot recovery: re-post alerts left in `pending` (committed but never attempted). Alerts stuck in
   * `posting` are ambiguous (may already be in Slack) so they are marked failed and reported to ops.
   */
  async resume(walletsById: Map<string, Wallet>, thresholdsFor: (w: Wallet, coin: string) => { thresholds: Thresholds; routing: Routing }): Promise<void> {
    const { repo, log } = this.d;
    const stuck = await repo.listAlertsByStatus("posting");
    for (const a of stuck) {
      await repo.updateAlert(a.id, { status: "failed", error: "worker restarted mid-post; not re-sent to avoid duplicates" });
    }
    if (stuck.length) await this.postOps("warn", `${stuck.length} alert(s) were mid-post during restart and were not re-sent`, { ids: stuck.map((a) => a.id) });

    const pending = await repo.listAlertsByStatus("pending");
    for (const a of pending) {
      if (!a.eventId) {
        await repo.updateAlert(a.id, { status: "failed", error: "pending cluster alert dropped on restart" });
        continue;
      }
      const ev: StoredEvent | null = await repo.getEvent(a.eventId);
      const wallet = ev ? walletsById.get(ev.walletId) : undefined;
      if (!ev || !wallet) {
        await repo.updateAlert(a.id, { status: "failed", error: "event or wallet missing on resume" });
        continue;
      }
      // mark the stale pending row failed; postEvent creates a fresh alerts_sent row
      await repo.updateAlert(a.id, { status: "failed", error: "superseded by resume re-post" });
      const { thresholds, routing } = thresholdsFor(wallet, ev.coin);
      const decision: Decision = { filtered: false, filterReason: null, score: ev.score, components: ev.components, channel: (ev.channel as "high" | "feed") ?? "feed" };
      try {
        await this.postEvent({ eventId: ev.id, event: ev, wallet, decision, thresholds, routing });
      } catch (e) {
        log.error({ err: errMsg(e), eventId: ev.id }, "resume re-post failed");
      }
    }
    if (pending.length) log.info({ n: pending.length }, "resumed pending alerts");
  }
}
