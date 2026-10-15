import { sameSize } from "./classifier.js";
import type { PositionState } from "./types.js";

export interface PendingWindow {
  walletId: string;
  coin: string;
  /** committed state when the window opened (s0) */
  base: PositionState;
  /** most recent observed state (becomes s1 at flush) */
  latest: PositionState;
  /** ms epoch of first observed change */
  openedAt: number;
  /** ms epoch of most recent observed change */
  lastChangeAt: number;
  observations: number;
}

export interface FlushedWindow {
  walletId: string;
  coin: string;
  prev: PositionState;
  next: PositionState;
  windowStart: number;
  windowEnd: number;
  observations: number;
}

export function windowKey(walletId: string, coin: string): string {
  return `${walletId}:${coin}`;
}

/**
 * Coalesces position changes for the same wallet+coin into fixed windows.
 * - First observed change opens a window (openedAt = now).
 * - Subsequent changes within the window just update `latest`.
 * - `flushExpired(now)` returns windows older than windowMs, so the caller can classify s0 -> s1.
 *
 * Pure in-memory; the caller owns "committed" state (what `base` is compared against).
 */
export class WindowAggregator {
  private readonly windows = new Map<string, PendingWindow>();

  constructor(private windowMs: number) {}

  setWindowMs(ms: number): void {
    this.windowMs = ms;
  }

  get size(): number {
    return this.windows.size;
  }

  has(walletId: string, coin: string): boolean {
    return this.windows.has(windowKey(walletId, coin));
  }

  get(walletId: string, coin: string): PendingWindow | undefined {
    return this.windows.get(windowKey(walletId, coin));
  }

  /**
   * Observe the live state for wallet+coin against the committed state.
   * Returns true if a window is open for this key after the call.
   */
  observe(walletId: string, coin: string, committed: PositionState, live: PositionState, now: number): boolean {
    const key = windowKey(walletId, coin);
    const existing = this.windows.get(key);
    if (existing) {
      if (!sameSize(existing.latest.szi, live.szi)) {
        existing.lastChangeAt = now;
        existing.observations++;
      }
      existing.latest = live;
      return true;
    }
    if (sameSize(committed.szi, live.szi)) return false;
    this.windows.set(key, {
      walletId,
      coin,
      base: committed,
      latest: live,
      openedAt: now,
      lastChangeAt: now,
      observations: 1,
    });
    return true;
  }

  /** Windows whose fixed duration has elapsed. They are removed from the aggregator. */
  flushExpired(now: number): FlushedWindow[] {
    const out: FlushedWindow[] = [];
    for (const [key, w] of this.windows) {
      if (now - w.openedAt >= this.windowMs) {
        this.windows.delete(key);
        out.push(this.toFlushed(w, now));
      }
    }
    return out;
  }

  /** Flush everything regardless of age (shutdown / tests). */
  flushAll(now: number): FlushedWindow[] {
    const out: FlushedWindow[] = [];
    for (const [key, w] of this.windows) {
      this.windows.delete(key);
      out.push(this.toFlushed(w, now));
    }
    return out;
  }

  private toFlushed(w: PendingWindow, now: number): FlushedWindow {
    return {
      walletId: w.walletId,
      coin: w.coin,
      prev: w.base,
      next: w.latest,
      windowStart: w.openedAt,
      windowEnd: Math.min(now, w.openedAt + this.windowMs),
      observations: w.observations,
    };
  }
}
