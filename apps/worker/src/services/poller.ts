import pLimit from "p-limit";
import { computePollIntervalSec, type TokenBucket, type Wallet } from "@sma/core";
import type { PositionSourceAdapter } from "../adapters/PositionSourceAdapter.js";
import { backoffMs, errMsg, type Logger } from "../logger.js";
import type { ConfigLoader } from "./configLoader.js";
import type { Processor } from "./processor.js";

export interface PollerDeps {
  adapter: PositionSourceAdapter;
  config: ConfigLoader;
  processor: Processor;
  bucket: TokenBucket;
  log: Logger;
  budgetPerMin: number;
  minIntervalSec: number;
  concurrency?: number;
}

export interface PollerStats {
  lastLoopAt: number;
  loopMs: number;
  intervalSec: number;
  walletsPolled: number;
  errorTimes: number[];
  cycles: number;
}

/** Main poll+diff loop with per-wallet error isolation, backoff and wake-able sleeps (WS triggers). */
export class Poller {
  readonly stats: PollerStats = { lastLoopAt: 0, loopMs: 0, intervalSec: 0, walletsPolled: 0, errorTimes: [], cycles: 0 };
  private stopped = false;
  private wake: (() => void) | null = null;
  private readonly skipUntil = new Map<string, number>();
  private readonly errors = new Map<string, number>();
  private readonly urgent = new Set<string>();
  private readonly limit: ReturnType<typeof pLimit>;

  constructor(private readonly d: PollerDeps) {
    this.limit = pLimit(d.concurrency ?? 4);
  }

  stop(): void {
    this.stopped = true;
    this.wake?.();
  }

  /** Request an immediate poll of one wallet (by address). Used by the WS trigger for priority wallets. */
  trigger(address: string): void {
    this.urgent.add(address.toLowerCase());
    this.wake?.();
  }

  errorsInLastHour(): number {
    const cutoff = Date.now() - 3600_000;
    this.stats.errorTimes = this.stats.errorTimes.filter((t) => t > cutoff);
    return this.stats.errorTimes.length;
  }

  async runForever(): Promise<void> {
    while (!this.stopped) {
      const started = Date.now();
      try {
        await this.cycle(this.d.config.activeWallets);
      } catch (e) {
        this.d.log.error({ err: errMsg(e) }, "cycle failed");
      }
      this.stats.cycles++;
      this.stats.lastLoopAt = Date.now();
      this.stats.loopMs = this.stats.lastLoopAt - started;
      const waitMs = Math.max(250, this.stats.intervalSec * 1000 - this.stats.loopMs);
      await this.sleepOrWake(waitMs);
      while (!this.stopped && this.urgent.size > 0) {
        const addrs = [...this.urgent];
        this.urgent.clear();
        const wallets = this.d.config.activeWallets.filter((w) => addrs.includes(w.address));
        this.d.log.debug({ n: wallets.length }, "urgent poll (ws trigger)");
        await this.cycle(wallets, { urgent: true });
      }
    }
  }

  async cycle(wallets: Wallet[], opts: { urgent?: boolean } = {}): Promise<void> {
    const { adapter, processor, config, log } = this.d;
    const t = config.globalThresholds;
    processor.aggregator.setWindowMs(t.agg_window_sec * 1000);
    if (!opts.urgent) this.stats.intervalSec = computePollIntervalSec(config.activeWallets.length, this.d.budgetPerMin, this.d.minIntervalSec);

    let marks: Record<string, number> = {};
    try {
      marks = await adapter.getMarkPrices();
    } catch (e) {
      log.warn({ err: errMsg(e) }, "allMids failed; using position values for marks");
    }

    const now = Date.now();
    let polled = 0;
    await Promise.all(
      wallets.map((w) =>
        this.limit(async () => {
          if ((this.skipUntil.get(w.id) ?? 0) > now) return;
          try {
            const snap = await adapter.getPositions(w.address, marks);
            await processor.handleSnapshot(w, snap, Date.now());
            this.errors.delete(w.id);
            polled++;
          } catch (e) {
            const n = (this.errors.get(w.id) ?? 0) + 1;
            this.errors.set(w.id, n);
            this.stats.errorTimes.push(Date.now());
            const delay = backoffMs(n, 5_000, 10 * 60_000);
            this.skipUntil.set(w.id, Date.now() + delay);
            log.warn({ wallet: w.label, attempt: n, retryInMs: delay, err: errMsg(e) }, "wallet poll failed; backing off");
            await processor.patchWalletState(w.id, { consecutiveErrors: n, lastError: errMsg(e) }).catch(() => undefined);
          }
        }),
      ),
    );
    if (!opts.urgent) this.stats.walletsPolled = polled;

    const flushed = await processor.flushAndProcess(Date.now());
    if (flushed) log.debug({ flushed, pending: processor.aggregator.size }, "windows flushed");
  }

  private sleepOrWake(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.wake = null;
        resolve();
      }, ms);
      this.wake = () => {
        clearTimeout(timer);
        this.wake = null;
        resolve();
      };
    });
  }
}
