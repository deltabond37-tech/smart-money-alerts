import type { AlertRule, ClusterCandidate, CoinTier, Decision, Fill, PositionEvent, PositionState, Wallet, WalletStats } from "@sma/core";

export interface ConfigBundle {
  wallets: Wallet[];
  rules: AlertRule[];
  coinTiers: Record<string, CoinTier>;
}

export interface SnapshotRow {
  walletId: string;
  coin: string;
  state: PositionState;
  /** ms epoch when this state was committed */
  committedAt: number;
}

export interface WalletStateRow {
  walletId: string;
  lastFillTime: number;
  lastFillsSyncAt: number | null;
  lastPollAt: number | null;
  accountValue: number | null;
  consecutiveErrors: number;
  lastError: string | null;
  autoFlags: { mm?: boolean; fills_per_day?: number; drift_ratio?: number; at?: string };
}

export interface StoredEvent extends PositionEvent {
  id: string;
  score: number;
  filtered: boolean;
  filterReason: string | null;
  channel: string | null;
  lifecycleId: string | null;
  components: Decision["components"];
  createdAt: number;
}

export interface EventInsert {
  eventKey: string;
  event: PositionEvent;
  decision: Decision;
  channel: string | null;
  lifecycleId: string | null;
}

export interface ThreadRow {
  lifecycleId: string;
  walletId: string;
  coin: string;
  channel: string;
  threadTs: string;
  openedAt: number;
  closedAt: number | null;
}

export interface AlertRow {
  id: string;
  eventId: string | null;
  clusterId: string | null;
  channel: string;
  ts: string | null;
  threadTs: string | null;
  status: "pending" | "posting" | "sent" | "failed";
  error: string | null;
  attempts: number;
}

export interface ClusterRow {
  id: string;
  coin: string;
  direction: "long" | "short";
  windowStart: number;
  windowEnd: number;
  walletIds: string[];
  eventIds: string[];
  channel: string | null;
  threadTs: string | null;
}

export interface HeartbeatRow {
  workerId: string;
  lastLoopAt: number;
  loopMs: number;
  intervalSec: number;
  walletsPolled: number;
  budgetUsedPerMin: number;
  errors1h: number;
  version: string;
  dryRun: boolean;
}

/** Persistence boundary. Implemented by SupabaseRepo (prod) and MemoryRepo (tests). */
export interface Repo {
  loadConfig(): Promise<ConfigBundle>;
  loadSnapshots(): Promise<SnapshotRow[]>;
  upsertSnapshots(rows: SnapshotRow[]): Promise<void>;
  loadWalletStates(): Promise<WalletStateRow[]>;
  upsertWalletState(walletId: string, patch: Partial<Omit<WalletStateRow, "walletId">>): Promise<void>;

  /** Atomic event + snapshot commit. Returns event id, or null if event_key already exists. */
  commitEvent(ins: EventInsert, snapshot: SnapshotRow): Promise<string | null>;
  setEventLifecycle(eventId: string, lifecycleId: string): Promise<void>;
  getEvent(eventId: string): Promise<StoredEvent | null>;
  walletStats(walletId: string, days?: number): Promise<WalletStats>;
  /** last alerted (not filtered) window_end per wallet+coin since `sinceMs` */
  loadLastAlerts(sinceMs: number): Promise<Array<{ walletId: string; coin: string; windowEnd: number }>>;
  /** OPEN/INCREASE events since `sinceMs` that are eligible for clustering */
  clusterCandidates(sinceMs: number): Promise<ClusterCandidate[]>;

  getOpenThread(walletId: string, coin: string): Promise<ThreadRow | null>;
  createThread(row: Omit<ThreadRow, "lifecycleId" | "closedAt">): Promise<ThreadRow>;
  closeThread(lifecycleId: string, closedAt: number): Promise<void>;

  createAlert(row: Pick<AlertRow, "eventId" | "clusterId" | "channel">): Promise<AlertRow>;
  updateAlert(id: string, patch: Partial<AlertRow> & { sentAt?: number }): Promise<void>;
  listAlertsByStatus(status: AlertRow["status"]): Promise<AlertRow[]>;

  findActiveCluster(coin: string, direction: "long" | "short", sinceMs: number): Promise<ClusterRow | null>;
  createCluster(row: Omit<ClusterRow, "id">): Promise<ClusterRow>;
  updateCluster(id: string, patch: Partial<Omit<ClusterRow, "id">>): Promise<void>;

  insertFills(walletId: string, fills: Fill[]): Promise<number>;
  fillsSince(walletId: string, sinceMs: number): Promise<Fill[]>;

  heartbeat(row: HeartbeatRow): Promise<void>;
  prune(days: number): Promise<{ fills: number; snapshots: number; heartbeats: number }>;
}
