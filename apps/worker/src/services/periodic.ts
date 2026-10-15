import { isLikelyMarketMaker, marketMakerStats, resolveRules } from "@sma/core";
import type { PositionSourceAdapter } from "../adapters/PositionSourceAdapter.js";
import type { Repo } from "../db/repo.js";
import { errMsg, type Logger } from "../logger.js";
import type { Alerter } from "./alerter.js";
import type { ConfigLoader } from "./configLoader.js";
import type { Poller } from "./poller.js";
import type { Processor } from "./processor.js";
import type { MonitoredSlackPoster } from "./slack.js";

const OPS_THROTTLE_MS = 15 * 60_000;

export interface PeriodicDeps {
  repo: Repo;
  adapter: PositionSourceAdapter;
  config: ConfigLoader;
  processor: Processor;
  poller: Poller;
  alerter: Alerter;
  slack: MonitoredSlackPoster;
  log: Logger;
  workerId: string;
  version: string;
  dryRun: boolean;
  fillsSyncSec: number;
  retentionDays: number;
  budgetUsed: () => number;
}

/** Heartbeat (1 min), fills sync + MM detection (15 min), retention (daily), ops alerts. */
export class Periodic {
  private timers: NodeJS.Timeout[] = [];
  private lastOps = new Map<string, number>();
  private fillsRunning = false;

  constructor(private readonly d: PeriodicDeps) {}

  start(): void {
    this.timers.push(setInterval(() => void this.heartbeat(), 60_000));
    this.timers.push(setInterval(() => void this.fillsSync(), this.d.fillsSyncSec * 1000));
    this.timers.push(setInterval(() => void this.retention(), 24 * 3600_000));
    setTimeout(() => void this.fillsSync(), 30_000);
    setTimeout(() => void this.retention(), 5 * 60_000);
  }

  stop(): void {
    for (const t of this.timers) clearInterval(t);
  }

  private async opsThrottled(key: string, level: "warn" | "error", title: string, details: Record<string, unknown>): Promise<void> {
    const last = this.lastOps.get(key) ?? 0;
    if (Date.now() - last < OPS_THROTTLE_MS) return;
    this.lastOps.set(key, Date.now());
    await this.d.alerter.postOps(level, title, details);
  }

  async heartbeat(): Promise<void> {
    const { poller, repo, log } = this.d;
    const s = poller.stats;
    try {
      await repo.heartbeat({
        workerId: this.d.workerId,
        lastLoopAt: s.lastLoopAt || Date.now(),
        loopMs: s.loopMs,
        intervalSec: s.intervalSec,
        walletsPolled: s.walletsPolled,
        budgetUsedPerMin: Math.round(this.d.budgetUsed()),
        errors1h: poller.errorsInLastHour(),
        version: this.d.version,
        dryRun: this.d.dryRun,
      });
    } catch (e) {
      log.error({ err: errMsg(e) }, "heartbeat write failed");
    }
    const lagMs = s.lastLoopAt ? Date.now() - s.lastLoopAt : 0;
    if (s.cycles > 0 && s.intervalSec > 0 && lagMs > 3 * s.intervalSec * 1000) {
      await this.opsThrottled("lag", "warn", "Poll loop lagging", { lag_sec: Math.round(lagMs / 1000), interval_sec: s.intervalSec, loop_ms: s.loopMs });
    }
    if (this.d.slack.consecutiveFailures >= 3) {
      await this.opsThrottled("slack", "error", "Slack posting failing repeatedly", { consecutive_failures: this.d.slack.consecutiveFailures });
    }
  }

  /** Ingest fills since last sync (bounded to 24h) and refresh market-maker auto-flags per wallet. */
  async fillsSync(): Promise<void> {
    if (this.fillsRunning) return;
    this.fillsRunning = true;
    const { adapter, repo, processor, config, log } = this.d;
    const dayAgo = Date.now() - 24 * 3600_000;
    let flagged = 0;
    try {
      for (const w of config.activeWallets) {
        try {
          const st = processor.walletState.get(w.id);
          const from = Math.max((st?.lastFillTime ?? 0) + 1, dayAgo);
          const fills = await adapter.getFills(w.address, from);
          if (fills.length) await repo.insertFills(w.id, fills);
          const recent = await repo.fillsSince(w.id, dayAgo);
          const stats = marketMakerStats(recent, 24);
          const { thresholds } = resolveRules(config.current, w, "*");
          const mm = isLikelyMarketMaker(stats, thresholds.mm);
          if (mm) flagged++;
          const wasMm = st?.autoFlags?.mm === true;
          if (mm !== wasMm) log.info({ wallet: w.label, mm, fillsPerDay: Math.round(stats.fillsPerDay), drift: stats.driftRatio.toFixed(3) }, "market-maker flag changed");
          await processor.patchWalletState(w.id, {
            lastFillsSyncAt: Date.now(),
            lastFillTime: Math.max(st?.lastFillTime ?? 0, ...fills.map((f) => f.time)),
            autoFlags: { mm, fills_per_day: Math.round(stats.fillsPerDay), drift_ratio: Number(stats.driftRatio.toFixed(4)), at: new Date().toISOString() },
          });
        } catch (e) {
          log.warn({ wallet: w.label, err: errMsg(e) }, "fills sync failed for wallet");
        }
      }
      log.info({ wallets: config.activeWallets.length, mmFlagged: flagged }, "fills sync complete");
    } finally {
      this.fillsRunning = false;
    }
  }

  async retention(): Promise<void> {
    try {
      const r = await this.d.repo.prune(this.d.retentionDays);
      this.d.log.info(r, "retention prune complete");
    } catch (e) {
      this.d.log.error({ err: errMsg(e) }, "retention prune failed");
    }
  }
}
