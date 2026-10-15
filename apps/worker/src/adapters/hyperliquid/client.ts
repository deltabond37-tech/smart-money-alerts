import { TokenBucket } from "@sma/core";
import { backoffMs, errMsg, sleep, type Logger } from "../../logger.js";

export class HlHttpError extends Error {
  constructor(
    public readonly status: number,
    body: string,
  ) {
    super(`Hyperliquid HTTP ${status}: ${body.slice(0, 200)}`);
  }
}

export interface HlClientOptions {
  baseUrl: string;
  bucket: TokenBucket;
  log: Logger;
  maxAttempts?: number;
  timeoutMs?: number;
}

/** Thin POST /info client with rate-limit budgeting, timeouts and retry/backoff on 429/5xx/network errors. */
export class HlInfoClient {
  private readonly maxAttempts: number;
  private readonly timeoutMs: number;

  constructor(private readonly o: HlClientOptions) {
    this.maxAttempts = o.maxAttempts ?? 4;
    this.timeoutMs = o.timeoutMs ?? 15_000;
  }

  /** Record weight consumed without waiting (e.g. per-item surcharge known only after the response). */
  account(weight: number): void {
    if (weight > 0) this.o.bucket.take(weight);
  }

  async info<T>(body: Record<string, unknown>, weight: number): Promise<T> {
    const wait = this.o.bucket.take(weight);
    if (wait > 0) {
      this.o.log.debug({ wait, type: body.type }, "budget wait");
      await sleep(wait);
    }
    let lastErr: unknown;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
        try {
          const res = await fetch(`${this.o.baseUrl}/info`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
            signal: ctrl.signal,
          });
          if (!res.ok) {
            const text = await res.text().catch(() => "");
            const err = new HlHttpError(res.status, text);
            if (res.status === 429 || res.status >= 500) throw err;
            throw Object.assign(err, { fatal: true });
          }
          return (await res.json()) as T;
        } finally {
          clearTimeout(timer);
        }
      } catch (e) {
        lastErr = e;
        if ((e as { fatal?: boolean }).fatal || attempt === this.maxAttempts) break;
        const is429 = e instanceof HlHttpError && e.status === 429;
        const delay = is429 ? Math.max(5_000, backoffMs(attempt, 5_000, 60_000)) : backoffMs(attempt, 500, 15_000);
        this.o.log.warn({ attempt, delay, type: body.type, err: errMsg(e) }, "hyperliquid request failed, retrying");
        await sleep(delay);
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  }
}
