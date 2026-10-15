/** Hyperliquid info endpoint weights (docs, Oct 2026). */
export const HL_WEIGHTS = {
  clearinghouseState: 2,
  allMids: 2,
  l2Book: 2,
  metaAndAssetCtxs: 20,
  /** base weight; +1 per 20 fills returned */
  userFillsByTime: 20,
  userFills: 20,
  other: 20,
} as const;

export const HL_IP_LIMIT_PER_MIN = 1200;

/** Weight of a userFillsByTime call that returned n fills. */
export function fillsWeight(nFills: number): number {
  return HL_WEIGHTS.userFillsByTime + Math.floor(nFills / 20);
}

/** Weight of one full poll cycle: one allMids + one clearinghouseState per wallet. */
export function cycleWeight(walletCount: number): number {
  return HL_WEIGHTS.allMids + walletCount * HL_WEIGHTS.clearinghouseState;
}

/**
 * Poll interval (seconds) so that the steady-state cycle cost fits in the budget, leaving `reserveWeightPerMin`
 * for on-demand fills calls and background syncs.
 */
export function computePollIntervalSec(
  walletCount: number,
  budgetWeightPerMin: number,
  minIntervalSec = 5,
  reserveWeightPerMin = 200,
): number {
  const usable = Math.max(1, budgetWeightPerMin - reserveWeightPerMin);
  const perSec = usable / 60;
  const needed = Math.ceil(cycleWeight(walletCount) / perSec);
  return Math.max(minIntervalSec, needed);
}

/**
 * Token bucket refilling continuously at `capacityPerMin` per minute (so a burst of up to `capacity`).
 * `take(weight)` returns how long (ms) to wait before the call may proceed; it always reserves the tokens.
 */
export class TokenBucket {
  private tokens: number;
  private last: number;
  private readonly ratePerMs: number;
  private used = 0;
  private usedWindowStart: number;

  constructor(
    private readonly capacity: number,
    private readonly now: () => number = () => Date.now(),
  ) {
    this.tokens = capacity;
    this.last = now();
    this.usedWindowStart = this.last;
    this.ratePerMs = capacity / 60_000;
  }

  private refill(): void {
    const t = this.now();
    this.tokens = Math.min(this.capacity, this.tokens + (t - this.last) * this.ratePerMs);
    this.last = t;
    if (t - this.usedWindowStart >= 60_000) {
      this.used = 0;
      this.usedWindowStart = t;
    }
  }

  /** Reserve `weight` tokens. Returns ms the caller should wait (0 if allowed now). */
  take(weight: number): number {
    this.refill();
    this.used += weight;
    this.tokens -= weight;
    if (this.tokens >= 0) return 0;
    return Math.ceil(-this.tokens / this.ratePerMs);
  }

  available(): number {
    this.refill();
    return Math.max(0, this.tokens);
  }

  /** Weight consumed in the current ~1 minute window (for heartbeats). */
  usedThisMinute(): number {
    this.refill();
    return this.used;
  }
}
