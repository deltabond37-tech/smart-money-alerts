import { describe, expect, it } from "vitest";
import { classify, classifyType, summarizeFills } from "../src/classifier.js";
import { fill, pos, T0, W1 } from "./helpers.js";

const base = { walletId: W1, coin: "ETH", windowStart: T0, windowEnd: T0 + 120_000 };

describe("classifyType", () => {
  it("maps size transitions", () => {
    expect(classifyType(0, 5)).toBe("OPEN");
    expect(classifyType(5, 0)).toBe("CLOSE");
    expect(classifyType(5, 8)).toBe("INCREASE");
    expect(classifyType(-5, -8)).toBe("INCREASE");
    expect(classifyType(8, 5)).toBe("DECREASE");
    expect(classifyType(-8, -5)).toBe("DECREASE");
    expect(classifyType(5, -3)).toBe("FLIP");
    expect(classifyType(-5, 3)).toBe("FLIP");
    expect(classifyType(5, 5)).toBeNull();
    expect(classifyType(0, 0)).toBeNull();
    expect(classifyType(0.1 + 0.2, 0.3)).toBeNull();
  });
});

describe("classify", () => {
  it("OPEN long: metrics from mark price, no pct change", () => {
    const ev = classify({ ...base, prev: pos(0), next: pos(10) })!;
    expect(ev.eventType).toBe("OPEN");
    expect(ev.side).toBe("long");
    expect(ev.deltaSize).toBe(10);
    expect(ev.deltaNotionalUsd).toBe(30_000);
    expect(ev.newNotionalUsd).toBe(30_000);
    expect(ev.pctChange).toBeNull();
    expect(ev.equityPct).toBeCloseTo(3);
    expect(ev.leverage).toBe(5);
    expect(ev.realizedPnl).toBeNull();
  });

  it("OPEN short uses sign for side", () => {
    const ev = classify({ ...base, prev: pos(0), next: pos(-4) })!;
    expect(ev.eventType).toBe("OPEN");
    expect(ev.side).toBe("short");
    expect(ev.deltaSize).toBe(-4);
    expect(ev.deltaNotionalUsd).toBe(12_000);
  });

  it("CLOSE: side from prior, realized PnL summed from fills, equity uses prior notional", () => {
    const fills = [
      fill({ side: "A", sz: 6, px: 3100, closedPnl: 600, dir: "Close Long" }),
      fill({ side: "A", sz: 4, px: 3200, closedPnl: 800, dir: "Close Long", crossed: false }),
    ];
    const ev = classify({ ...base, prev: pos(10), next: pos(0, { entryPx: null, leverage: null }), fills })!;
    expect(ev.eventType).toBe("CLOSE");
    expect(ev.side).toBe("long");
    expect(ev.realizedPnl).toBe(1400);
    expect(ev.avgFillPx).toBeCloseTo((6 * 3100 + 4 * 3200) / 10);
    expect(ev.deltaNotionalUsd).toBeCloseTo(10 * ev.avgFillPx!);
    expect(ev.newNotionalUsd).toBe(0);
    expect(ev.equityPct).toBeCloseTo(3); // prior 30k / 1M
    expect(ev.leverage).toBe(5); // from prior
    expect(ev.entryPx).toBe(3000);
    expect(ev.takerRatio).toBe(0.5);
    expect(ev.fillCount).toBe(2);
  });

  it("INCREASE: pct change vs prior size", () => {
    const ev = classify({ ...base, prev: pos(10), next: pos(15) })!;
    expect(ev.eventType).toBe("INCREASE");
    expect(ev.pctChange).toBeCloseTo(50);
    expect(ev.deltaNotionalUsd).toBe(15_000);
    expect(ev.newNotionalUsd).toBe(45_000);
  });

  it("DECREASE: pct change, realized pnl from fills", () => {
    const ev = classify({ ...base, prev: pos(10), next: pos(5), fills: [fill({ side: "A", sz: 5, closedPnl: -250 })] })!;
    expect(ev.eventType).toBe("DECREASE");
    expect(ev.pctChange).toBeCloseTo(50);
    expect(ev.realizedPnl).toBe(-250);
  });

  it("FLIP: side is the new side, pct relative to prior size", () => {
    const ev = classify({ ...base, prev: pos(10), next: pos(-5) })!;
    expect(ev.eventType).toBe("FLIP");
    expect(ev.side).toBe("short");
    expect(ev.deltaSize).toBe(-15);
    expect(ev.pctChange).toBeCloseTo(150);
    expect(ev.deltaNotionalUsd).toBe(45_000);
  });

  it("returns null when net change is zero (round trip inside window)", () => {
    expect(classify({ ...base, prev: pos(10), next: pos(10) })).toBeNull();
  });

  it("ignores fills for other coins", () => {
    const ev = classify({ ...base, prev: pos(0), next: pos(1), fills: [fill({ coin: "BTC", px: 60_000, sz: 1 })] })!;
    expect(ev.fillCount).toBe(0);
    expect(ev.avgFillPx).toBeNull();
    expect(ev.deltaNotionalUsd).toBe(3000);
  });

  it("summarizeFills handles empty input", () => {
    expect(summarizeFills([])).toEqual({ avgPx: null, realizedPnl: 0, count: 0, takerRatio: null, sumSz: 0 });
  });
});
