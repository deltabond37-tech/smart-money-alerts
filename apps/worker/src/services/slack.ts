import { WebClient, type ChatPostMessageArguments } from "@slack/web-api";
import type { SlackMessage } from "@sma/core";
import { errMsg, type Logger } from "../logger.js";

export interface PostOptions {
  threadTs?: string;
  replyBroadcast?: boolean;
}

export interface PostResult {
  ts: string;
  channel: string;
}

export interface SlackPoster {
  readonly dryRun: boolean;
  post(channel: string, msg: SlackMessage, opts?: PostOptions): Promise<PostResult>;
}

export const DRY_TS_PREFIX = "dry-";
export const isDryTs = (ts: string | null | undefined): boolean => !!ts && ts.startsWith(DRY_TS_PREFIX);

export class WebApiSlackPoster implements SlackPoster {
  readonly dryRun = false;
  private readonly client: WebClient;
  constructor(
    token: string,
    private readonly log: Logger,
  ) {
    this.client = new WebClient(token, { retryConfig: { retries: 3, factor: 2, minTimeout: 1000, maxTimeout: 15_000 } });
  }

  async post(channel: string, msg: SlackMessage, opts: PostOptions = {}): Promise<PostResult> {
    const args: Record<string, unknown> = {
      channel,
      text: msg.text,
      blocks: msg.blocks,
      unfurl_links: false,
      unfurl_media: false,
      ...(opts.threadTs ? { thread_ts: opts.threadTs, reply_broadcast: opts.replyBroadcast ?? false } : {}),
    };
    const res = await this.client.chat.postMessage(args as unknown as ChatPostMessageArguments);
    if (!res.ok || !res.ts) throw new Error(`slack postMessage failed: ${res.error ?? "unknown"}`);
    return { ts: res.ts, channel: (res.channel as string | undefined) ?? channel };
  }
}

export class DryRunSlackPoster implements SlackPoster {
  readonly dryRun = true;
  constructor(private readonly log: Logger) {}

  async post(channel: string, msg: SlackMessage, opts: PostOptions = {}): Promise<PostResult> {
    const ts = `${DRY_TS_PREFIX}${Date.now()}.${Math.floor(Math.random() * 1e6)}`;
    this.log.info({ channel, thread_ts: opts.threadTs ?? null, broadcast: opts.replyBroadcast ?? false, text: msg.text, blocks: msg.blocks }, "DRY RUN slack post");
    return { ts, channel };
  }
}

/** Wraps a poster: counts consecutive failures so the heartbeat/ops alerting can react. */
export class MonitoredSlackPoster implements SlackPoster {
  consecutiveFailures = 0;
  readonly dryRun: boolean;
  constructor(
    private readonly inner: SlackPoster,
    private readonly log: Logger,
  ) {
    this.dryRun = inner.dryRun;
  }
  async post(channel: string, msg: SlackMessage, opts?: PostOptions): Promise<PostResult> {
    try {
      const r = await this.inner.post(channel, msg, opts);
      this.consecutiveFailures = 0;
      return r;
    } catch (e) {
      this.consecutiveFailures++;
      this.log.error({ channel, err: errMsg(e), consecutive: this.consecutiveFailures }, "slack post failed");
      throw e;
    }
  }
}
