import pino from "pino";
import { WindowAggregator, type Fill, type PositionState, type Wallet } from "@sma/core";
import type { PositionSourceAdapter, WalletSnapshot } from "../src/adapters/PositionSourceAdapter.js";
import { Alerter } from "../src/services/alerter.js";
import { ConfigLoader } from "../src/services/configLoader.js";
import { Processor } from "../src/services/processor.js";
import type { PostOptions, PostResult, SlackPoster } from "../src/services/slack.js";
import { MemoryRepo } from "./memoryRepo.js";

export const log = pino({ level: process.env.TEST_LOG ?? "silent" });

export const ADDR = (i: number) => `0x${i.toString(16).padStart(40, "0")}`;
export const T0 = Date.UTC(2026, 9, 13, 10, 0, 0);

export function wallet(i: number, over: Partial<Wallet> = {}): Wallet {
  return { id: `w${i}`, address: ADDR(i), label: `Wallet ${i}`, tier: "A", venue: "hyperliquid", isActive: true, isPriority: false, muted: false, overrides: {}, ...over };
}

export function pos(coin: string, szi: number, px = 3000, accountValue = 1_000_000): PositionState {
  return { coin, szi, entryPx: px, positionValue: Math.abs(szi) * px, leverage: 5, liqPx: szi > 0 ? px * 0.8 : px * 1.2, unrealizedPnl: 0, markPx: px, accountValue };
}

/** Scripted venue: positions per address are set by the test; fills are returned from a list. */
export class FakeAdapter implements PositionSourceAdapter {
  readonly venue = "fake";
  positions = new Map<string, PositionState[]>();
  fills = new Map<string, Fill[]>();
  accountValue = 1_000_000;
  calls = { positions: 0, fills: 0 };

  set(address: string, positions: PositionState[]) {
    this.positions.set(address, positions);
  }
  addFill(address: string, f: Partial<Fill> & { coin: string; sz: number; time: number }) {
    const arr = this.fills.get(address) ?? [];
    arr.push({ tid: arr.length + 1, hash: "0x", px: 3000, side: "B", dir: "Open Long", startPosition: 0, closedPnl: 0, fee: 0, crossed: true, ...f });
    this.fills.set(address, arr);
  }
  async getMarkPrices() {
    return { ETH: 3000, BTC: 60_000, SOL: 150 };
  }
  async getPositions(address: string): Promise<WalletSnapshot> {
    this.calls.positions++;
    return { address, accountValue: this.accountValue, positions: this.positions.get(address) ?? [], time: null };
  }
  async getFills(address: string, startMs: number, endMs?: number) {
    this.calls.fills++;
    return (this.fills.get(address) ?? []).filter((f) => f.time >= startMs && (endMs === undefined || f.time <= endMs));
  }
}

export class FakeSlack implements SlackPoster {
  readonly dryRun = false;
  posts: Array<{ channel: string; text: string; opts: PostOptions }> = [];
  failNext = 0;
  async post(channel: string, msg: { text: string }, opts: PostOptions = {}): Promise<PostResult> {
    if (this.failNext > 0) {
      this.failNext--;
      throw new Error("slack down");
    }
    this.posts.push({ channel, text: msg.text, opts });
    return { ts: `${1700000000 + this.posts.length}.000${this.posts.length}`, channel };
  }
}

export const CHANNELS = { high: "#high", feed: "#feed", clusters: "#clusters", ops: "#ops" };

export interface World {
  repo: MemoryRepo;
  adapter: FakeAdapter;
  slack: FakeSlack;
  config: ConfigLoader;
  processor: Processor;
  alerter: Alerter;
  aggregator: WindowAggregator;
  clock: { now: number };
  /** simulate one poll cycle at the current clock */
  poll(): Promise<void>;
  /** advance clock by ms and poll */
  tick(ms: number): Promise<void>;
}

/** Build a worker "world" that shares a repo (so a restart can be simulated by building a new world on the same repo). */
export async function makeWorld(opts: { repo?: MemoryRepo; adapter?: FakeAdapter; slack?: FakeSlack; wallets: Wallet[]; thresholds?: Record<string, unknown>; clock?: { now: number }; windowSec?: number }): Promise<World> {
  const repo = opts.repo ?? new MemoryRepo();
  const adapter = opts.adapter ?? new FakeAdapter();
  const slack = opts.slack ?? new FakeSlack();
  const clock = opts.clock ?? { now: T0 };
  repo.config = {
    wallets: opts.wallets,
    rules: [
      {
        scope: "global",
        scopeRef: null,
        eventTypes: ["OPEN", "CLOSE", "INCREASE", "DECREASE", "FLIP"],
        thresholds: { min_delta_notional_usd: 10_000, min_equity_pct: 0.5, score: { high: 60, low: 20 }, close_min_realized_pnl_usd: 0, agg_window_sec: opts.windowSec ?? 120, ...(opts.thresholds ?? {}) },
        routing: {},
        enabled: true,
      },
    ],
    coinTiers: { ETH: "major", BTC: "major", SOL: "major" },
  };
  const config = new ConfigLoader(repo, log, 60);
  await config.reload();
  const aggregator = new WindowAggregator((opts.windowSec ?? 120) * 1000);
  const alerter = new Alerter({ repo, slack, channels: CHANNELS, log, timeZone: "Asia/Kolkata", now: () => clock.now });
  const processor = new Processor({ repo, config, alerter, adapter, aggregator, log, now: () => clock.now });
  await processor.boot();
  const poll = async () => {
    for (const w of config.activeWallets) {
      const snap = await adapter.getPositions(w.address);
      await processor.handleSnapshot(w, snap, clock.now);
    }
    await processor.flushAndProcess(clock.now);
  };
  const tick = async (ms: number) => {
    clock.now += ms;
    await poll();
  };
  return { repo, adapter, slack, config, processor, alerter, aggregator, clock, poll, tick };
}
