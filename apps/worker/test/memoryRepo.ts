import { statsOf, type ClusterCandidate, type Fill, type WalletStats } from "@sma/core";
import type { AlertRow, ClusterRow, ConfigBundle, EventInsert, HeartbeatRow, Repo, SnapshotRow, StoredEvent, ThreadRow, WalletStateRow } from "../src/db/repo.js";

let seq = 0;
const uid = (p: string) => `${p}-${++seq}`;

/** In-memory Repo mirroring the SQL semantics that matter for tests (unique event_key, atomic commit, open-thread uniqueness). */
export class MemoryRepo implements Repo {
  config: ConfigBundle = { wallets: [], rules: [], coinTiers: {} };
  snapshots = new Map<string, SnapshotRow>();
  walletStates = new Map<string, WalletStateRow>();
  events = new Map<string, StoredEvent & { eventKey: string }>();
  threads: ThreadRow[] = [];
  alerts: AlertRow[] = [];
  clusters: ClusterRow[] = [];
  fills = new Map<string, Fill[]>();
  heartbeats: HeartbeatRow[] = [];

  async loadConfig() {
    return this.config;
  }
  async loadSnapshots() {
    return [...this.snapshots.values()];
  }
  async upsertSnapshots(rows: SnapshotRow[]) {
    for (const r of rows) this.snapshots.set(`${r.walletId}:${r.coin}`, r);
  }
  async loadWalletStates() {
    return [...this.walletStates.values()];
  }
  async upsertWalletState(walletId: string, patch: Partial<Omit<WalletStateRow, "walletId">>) {
    const cur = this.walletStates.get(walletId) ?? { walletId, lastFillTime: 0, lastFillsSyncAt: null, lastPollAt: null, accountValue: null, consecutiveErrors: 0, lastError: null, autoFlags: {} };
    this.walletStates.set(walletId, { ...cur, ...patch });
  }
  async commitEvent(ins: EventInsert, snapshot: SnapshotRow) {
    for (const e of this.events.values()) if (e.eventKey === ins.eventKey) return null;
    const id = uid("ev");
    this.events.set(id, {
      ...ins.event,
      id,
      eventKey: ins.eventKey,
      score: ins.decision.score,
      filtered: ins.decision.filtered,
      filterReason: ins.decision.filterReason,
      channel: ins.channel,
      lifecycleId: ins.lifecycleId,
      components: ins.decision.components,
      createdAt: Date.now(),
    });
    this.snapshots.set(`${snapshot.walletId}:${snapshot.coin}`, snapshot);
    return id;
  }
  async setEventLifecycle(eventId: string, lifecycleId: string) {
    const e = this.events.get(eventId);
    if (e) e.lifecycleId = lifecycleId;
  }
  async getEvent(eventId: string) {
    return this.events.get(eventId) ?? null;
  }
  async walletStats(walletId: string): Promise<WalletStats> {
    return statsOf([...this.events.values()].filter((e) => e.walletId === walletId && e.filterReason !== "dust").map((e) => Math.abs(e.deltaNotionalUsd)));
  }
  async loadLastAlerts(sinceMs: number) {
    return [...this.events.values()].filter((e) => !e.filtered && e.windowEnd >= sinceMs).map((e) => ({ walletId: e.walletId, coin: e.coin, windowEnd: e.windowEnd }));
  }
  async clusterCandidates(sinceMs: number): Promise<ClusterCandidate[]> {
    return [...this.events.values()]
      .filter((e) => (e.eventType === "OPEN" || e.eventType === "INCREASE") && e.windowEnd >= sinceMs)
      .filter((e) => !["dust", "mm_flagged", "muted", "coin_blacklist", "coin_not_whitelisted"].includes(e.filterReason ?? ""))
      .map((e) => ({ eventId: e.id, walletId: e.walletId, coin: e.coin, side: e.side, eventType: e.eventType, at: e.windowEnd }));
  }
  async getOpenThread(walletId: string, coin: string) {
    return this.threads.find((t) => t.walletId === walletId && t.coin === coin && t.closedAt === null) ?? null;
  }
  async createThread(row: Omit<ThreadRow, "lifecycleId" | "closedAt">) {
    if (await this.getOpenThread(row.walletId, row.coin)) throw new Error("unique violation: open thread exists");
    const t: ThreadRow = { ...row, lifecycleId: uid("lc"), closedAt: null };
    this.threads.push(t);
    return t;
  }
  async closeThread(lifecycleId: string, closedAt: number) {
    const t = this.threads.find((x) => x.lifecycleId === lifecycleId);
    if (t) t.closedAt = closedAt;
  }
  async createAlert(row: Pick<AlertRow, "eventId" | "clusterId" | "channel">) {
    const a: AlertRow = { id: uid("al"), ...row, ts: null, threadTs: null, status: "pending", error: null, attempts: 0 };
    this.alerts.push(a);
    return a;
  }
  async updateAlert(id: string, patch: Partial<AlertRow>) {
    const a = this.alerts.find((x) => x.id === id);
    if (a) Object.assign(a, patch);
  }
  async listAlertsByStatus(status: AlertRow["status"]) {
    return this.alerts.filter((a) => a.status === status);
  }
  async findActiveCluster(coin: string, direction: "long" | "short", sinceMs: number) {
    return this.clusters.filter((c) => c.coin === coin && c.direction === direction && c.windowEnd >= sinceMs).sort((a, b) => b.windowEnd - a.windowEnd)[0] ?? null;
  }
  async createCluster(row: Omit<ClusterRow, "id">) {
    const c: ClusterRow = { id: uid("cl"), ...row };
    this.clusters.push(c);
    return c;
  }
  async updateCluster(id: string, patch: Partial<Omit<ClusterRow, "id">>) {
    const c = this.clusters.find((x) => x.id === id);
    if (c) Object.assign(c, patch);
  }
  async insertFills(walletId: string, fills: Fill[]) {
    const arr = this.fills.get(walletId) ?? [];
    const seen = new Set(arr.map((f) => f.tid));
    let n = 0;
    for (const f of fills) if (!seen.has(f.tid)) (arr.push(f), n++);
    this.fills.set(walletId, arr);
    return n;
  }
  async fillsSince(walletId: string, sinceMs: number) {
    return (this.fills.get(walletId) ?? []).filter((f) => f.time >= sinceMs);
  }
  async heartbeat(row: HeartbeatRow) {
    this.heartbeats.push(row);
  }
  async prune() {
    return { fills: 0, snapshots: 0, heartbeats: 0 };
  }

  // test helpers
  sentAlerts() {
    return this.alerts.filter((a) => a.status === "sent");
  }
}
