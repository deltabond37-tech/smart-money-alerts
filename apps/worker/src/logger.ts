import pino, { type Logger } from "pino";

export type { Logger };

export function createLogger(level: string, workerId: string): Logger {
  const pretty = process.env.LOG_PRETTY === "true" || (process.stdout.isTTY && process.env.NODE_ENV !== "production");
  return pino({
    level,
    base: { worker: workerId },
    timestamp: pino.stdTimeFunctions.isoTime,
    ...(pretty ? { transport: { target: "pino-pretty", options: { colorize: true, translateTime: "HH:MM:ss" } } } : {}),
  });
}

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Exponential backoff with full jitter. attempt starts at 1. */
export function backoffMs(attempt: number, baseMs = 1000, maxMs = 60_000): number {
  const cap = Math.min(maxMs, baseMs * 2 ** (attempt - 1));
  return Math.floor(Math.random() * cap);
}

export function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
