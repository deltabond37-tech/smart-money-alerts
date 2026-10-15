import { DEFAULT_THRESHOLDS } from "../src/rules.js";
import type { Fill, PositionEvent, PositionState, Thresholds, Wallet } from "../src/types.js";

export const W1 = "11111111-1111-1111-1111-111111111111";
export const W2 = "22222222-2222-2222-2222-222222222222";
export const W3 = "33333333-3333-3333-3333-333333333333";
export const T0 = Date.UTC(2026, 9, 13, 10, 0, 0); // 2026-10-13T10:00:00Z

export function pos(szi: number, over: Partial<PositionState> = {}): PositionState {
  return {
    coin: "ETH",
    szi,
    entryPx: 3000,
    positionValue: Math.abs(szi) * 3000,
    leverage: 5,
    liqPx: szi > 0 ? 2500 : szi < 0 ? 3500 : null,
    unrealizedPnl: 0,
    markPx: 3000,
    accountValue: 1_000_000,
    ...over,
  };
}

export function fill(over: Partial<Fill> = {}): Fill {
  return {
    tid: Math.floor(Math.random() * 1e12),
    hash: "0xabc",
    coin: "ETH",
    px: 3000,
    sz: 1,
    side: "B",
    dir: "Open Long",
    startPosition: 0,
    closedPnl: 0,
    fee: 1,
    time: T0,
    crossed: true,
    ...over,
  };
}

export function event(over: Partial<PositionEvent> = {}): PositionEvent {
  return {
    walletId: W1,
    coin: "ETH",
    eventType: "OPEN",
    side: "long",
    windowStart: T0,
    windowEnd: T0 + 120_000,
    s0: 0,
    s1: 10,
    deltaSize: 10,
    deltaNotionalUsd: 30_000,
    pctChange: null,
    newNotionalUsd: 30_000,
    equityPct: 3,
    leverage: 5,
    entryPx: 3000,
    avgFillPx: 3000,
    markPx: 3000,
    liqPx: 2500,
    unrealizedPnl: 0,
    realizedPnl: null,
    fillCount: 1,
    takerRatio: 1,
    ...over,
  };
}

export function wallet(over: Partial<Wallet> = {}): Wallet {
  return {
    id: W1,
    address: "0x0000000000000000000000000000000000000a01",
    label: "Wallet A",
    tier: "A",
    venue: "hyperliquid",
    isActive: true,
    isPriority: false,
    muted: false,
    overrides: {},
    ...over,
  };
}

export function thresholds(over: Partial<Thresholds> = {}): Thresholds {
  return { ...DEFAULT_THRESHOLDS, ...over };
}

export const NO_CTX = { muted: false, mmFlagged: false, lastAlertAt: null };
