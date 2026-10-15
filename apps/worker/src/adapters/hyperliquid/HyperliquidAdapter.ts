import { fillsWeight, HL_WEIGHTS, type Fill, type PositionState } from "@sma/core";
import type { Logger } from "../../logger.js";
import type { PositionSourceAdapter, WalletSnapshot } from "../PositionSourceAdapter.js";
import type { HlInfoClient } from "./client.js";
import { HlUserFillsWatcher } from "./ws.js";

// ---- raw API shapes (subset) ----
export interface HlClearinghouseState {
  marginSummary: { accountValue: string; totalNtlPos: string; totalRawUsd: string; totalMarginUsed: string };
  assetPositions: Array<{
    type: string;
    position: {
      coin: string;
      szi: string;
      leverage: { type: "cross" | "isolated"; value: number };
      entryPx: string | null;
      positionValue: string;
      unrealizedPnl: string;
      liquidationPx: string | null;
      marginUsed: string;
    };
  }>;
  time: number;
}

export interface HlFill {
  coin: string;
  px: string;
  sz: string;
  side: "B" | "A";
  time: number;
  startPosition: string;
  dir: string;
  closedPnl: string;
  hash: string;
  oid: number;
  crossed: boolean;
  fee: string;
  feeToken?: string;
  tid: number;
}

const num = (s: string | number | null | undefined): number | null => {
  if (s === null || s === undefined) return null;
  const n = typeof s === "number" ? s : Number.parseFloat(s);
  return Number.isFinite(n) ? n : null;
};

export function mapClearinghouseState(address: string, raw: HlClearinghouseState, marks: Record<string, number> = {}): WalletSnapshot {
  const accountValue = num(raw.marginSummary?.accountValue);
  const positions: PositionState[] = [];
  for (const ap of raw.assetPositions ?? []) {
    const p = ap.position;
    const szi = num(p.szi) ?? 0;
    if (szi === 0) continue;
    const positionValue = num(p.positionValue);
    const markPx = marks[p.coin] ?? (positionValue !== null && szi !== 0 ? positionValue / Math.abs(szi) : null);
    positions.push({
      coin: p.coin,
      szi,
      entryPx: num(p.entryPx),
      positionValue,
      leverage: p.leverage ? num(p.leverage.value) : null,
      liqPx: num(p.liquidationPx),
      unrealizedPnl: num(p.unrealizedPnl),
      markPx,
      accountValue,
    });
  }
  return { address, accountValue, positions, time: raw.time ?? null };
}

export function mapFill(f: HlFill): Fill {
  return {
    tid: f.tid,
    hash: f.hash,
    coin: f.coin,
    px: num(f.px) ?? 0,
    sz: num(f.sz) ?? 0,
    side: f.side,
    dir: f.dir,
    startPosition: num(f.startPosition) ?? 0,
    closedPnl: num(f.closedPnl) ?? 0,
    fee: num(f.fee) ?? 0,
    time: f.time,
    crossed: Boolean(f.crossed),
  };
}

const FILLS_PAGE_MAX = 2000;

export class HyperliquidAdapter implements PositionSourceAdapter {
  readonly venue = "hyperliquid";

  constructor(
    private readonly client: HlInfoClient,
    private readonly log: Logger,
    private readonly wsUrl?: string,
  ) {}

  async getMarkPrices(): Promise<Record<string, number>> {
    const raw = await this.client.info<Record<string, string>>({ type: "allMids" }, HL_WEIGHTS.allMids);
    const out: Record<string, number> = {};
    for (const [coin, px] of Object.entries(raw)) {
      const n = num(px);
      if (n !== null) out[coin] = n;
    }
    return out;
  }

  async getPositions(address: string, marks: Record<string, number> = {}): Promise<WalletSnapshot> {
    const raw = await this.client.info<HlClearinghouseState>({ type: "clearinghouseState", user: address }, HL_WEIGHTS.clearinghouseState);
    return mapClearinghouseState(address, raw, marks);
  }

  async getFills(address: string, startMs: number, endMs?: number): Promise<Fill[]> {
    const out: Fill[] = [];
    let cursor = startMs;
    for (let page = 0; page < 10; page++) {
      const body: Record<string, unknown> = { type: "userFillsByTime", user: address, startTime: cursor };
      if (endMs !== undefined) body.endTime = endMs;
      const raw = await this.client.info<HlFill[]>(body, HL_WEIGHTS.userFillsByTime);
      // extra weight: +1 per 20 fills returned (accounted after the fact, no wait)
      this.client.account(fillsWeight(raw.length) - HL_WEIGHTS.userFillsByTime);
      out.push(...raw.map(mapFill));
      if (raw.length < FILLS_PAGE_MAX) break;
      const last = raw[raw.length - 1]!;
      cursor = last.time + 1;
    }
    out.sort((a, b) => a.time - b.time || a.tid - b.tid);
    return out;
  }

  watch(addresses: string[], onActivity: (address: string) => void): () => void {
    if (!this.wsUrl) return () => {};
    const w = new HlUserFillsWatcher(this.wsUrl, addresses, onActivity, this.log);
    w.start();
    return () => w.stop();
  }
}
