import WebSocket from "ws";
import { errMsg, type Logger } from "../../logger.js";

/** HL caps user-specific WS subscriptions at 10 unique users per IP. */
export const HL_WS_MAX_USERS = 10;

/**
 * Subscribes to `userFills` for a few priority wallets and calls `onActivity(address)` whenever a
 * non-snapshot fill arrives. Used purely as a trigger to poll that wallet immediately; REST stays the
 * source of truth. Reconnects with backoff.
 */
export class HlUserFillsWatcher {
  private ws: WebSocket | null = null;
  private stopped = false;
  private attempt = 0;
  private ping: NodeJS.Timeout | null = null;

  constructor(
    private readonly url: string,
    private readonly addresses: string[],
    private readonly onActivity: (address: string) => void,
    private readonly log: Logger,
  ) {
    if (addresses.length > HL_WS_MAX_USERS) {
      this.log.warn({ n: addresses.length }, `more than ${HL_WS_MAX_USERS} priority wallets; only the first ${HL_WS_MAX_USERS} get WS triggers`);
      this.addresses = addresses.slice(0, HL_WS_MAX_USERS);
    }
  }

  start(): void {
    if (this.addresses.length === 0) return;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    if (this.ping) clearInterval(this.ping);
    this.ws?.close();
  }

  private connect(): void {
    if (this.stopped) return;
    const ws = new WebSocket(this.url);
    this.ws = ws;
    ws.on("open", () => {
      this.attempt = 0;
      this.log.info({ n: this.addresses.length }, "ws connected; subscribing userFills");
      for (const user of this.addresses) {
        ws.send(JSON.stringify({ method: "subscribe", subscription: { type: "userFills", user } }));
      }
      this.ping = setInterval(() => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify({ method: "ping" })), 50_000);
    });
    ws.on("message", (buf) => {
      try {
        const msg = JSON.parse(buf.toString()) as { channel?: string; data?: { user?: string; isSnapshot?: boolean; fills?: unknown[] } };
        if (msg.channel !== "userFills" || !msg.data?.user) return;
        if (msg.data.isSnapshot) return;
        if ((msg.data.fills?.length ?? 0) > 0) this.onActivity(msg.data.user.toLowerCase());
      } catch (e) {
        this.log.debug({ err: errMsg(e) }, "ws message parse error");
      }
    });
    ws.on("close", () => {
      if (this.ping) clearInterval(this.ping);
      if (this.stopped) return;
      this.attempt++;
      const delay = Math.min(60_000, 1000 * 2 ** this.attempt) * (0.5 + Math.random());
      this.log.warn({ delay: Math.round(delay) }, "ws closed; reconnecting");
      setTimeout(() => this.connect(), delay);
    });
    ws.on("error", (e) => this.log.warn({ err: errMsg(e) }, "ws error"));
  }
}
