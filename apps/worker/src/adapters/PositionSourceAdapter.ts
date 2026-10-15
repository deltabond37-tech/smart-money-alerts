import type { Fill, PositionState } from "@sma/core";

export interface WalletSnapshot {
  address: string;
  accountValue: number | null;
  /** only non-flat positions; flat coins are implied by absence */
  positions: PositionState[];
  /** venue time (ms) if provided */
  time: number | null;
}

/**
 * Venue abstraction. Implementations must be side-effect free apart from network I/O and must
 * account for rate-limit weight through the budget they are constructed with.
 */
export interface PositionSourceAdapter {
  readonly venue: string;
  /** Current mark prices keyed by coin. */
  getMarkPrices(): Promise<Record<string, number>>;
  /** Current positions + account equity for one wallet. */
  getPositions(address: string, marks?: Record<string, number>): Promise<WalletSnapshot>;
  /** Fills in [startMs, endMs], oldest first. Implementations page as needed. */
  getFills(address: string, startMs: number, endMs?: number): Promise<Fill[]>;
  /** Optional low-latency trigger for a small set of wallets. */
  watch?(addresses: string[], onActivity: (address: string) => void): () => void;
}
