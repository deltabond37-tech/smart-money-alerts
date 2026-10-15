import { createHash } from "node:crypto";

/** Normalise a size so 0.1+0.2 style noise can't change the key. 10 dp is beyond HL's size precision. */
export function normSize(n: number): string {
  const s = n.toFixed(10).replace(/\.?0+$/, "");
  return s === "-0" || s === "" ? "0" : s;
}

/**
 * Deterministic idempotency key for a classified event:
 * sha256(walletId|coin|windowEndIso|s0|s1). Same inputs always produce the same key, so a restart that
 * re-derives the same window cannot double-insert (UNIQUE on position_events.event_key).
 */
export function eventKey(walletId: string, coin: string, windowEndMs: number, s0: number, s1: number): string {
  const payload = `${walletId.toLowerCase()}|${coin.toUpperCase()}|${new Date(windowEndMs).toISOString()}|${normSize(s0)}|${normSize(s1)}`;
  return createHash("sha256").update(payload).digest("hex");
}
