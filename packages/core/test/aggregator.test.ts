import { describe, expect, it } from "vitest";
import { WindowAggregator } from "../src/aggregator.js";
import { classify } from "../src/classifier.js";
import { pos, T0, W1, W2 } from "./helpers.js";

describe("WindowAggregator", () => {
  it("TWAP: 10 fills over 2 minutes coalesce into exactly ONE event with the net change", () => {
    const agg = new WindowAggregator(120_000);
    const committed = pos(0);
    // 10 observations, each +1 ETH, 12s apart
    for (let i = 1; i <= 10; i++) {
      agg.observe(W1, "ETH", committed, pos(i), T0 + i * 12_000);
      expect(agg.flushExpired(T0 + i * 12_000)).toHaveLength(0); // nothing flushes before window elapses
    }
    expect(agg.size).toBe(1);
    const flushed = agg.flushExpired(T0 + 12_000 + 120_000);
    expect(flushed).toHaveLength(1);
    const w = flushed[0]!;
    expect(w.prev.szi).toBe(0);
    expect(w.next.szi).toBe(10);
    expect(w.observations).toBe(10);
    expect(w.windowStart).toBe(T0 + 12_000);
    expect(w.windowEnd).toBe(T0 + 12_000 + 120_000);
    const ev = classify({ walletId: W1, coin: "ETH", prev: w.prev, next: w.next, windowStart: w.windowStart, windowEnd: w.windowEnd })!;
    expect(ev.eventType).toBe("OPEN");
    expect(ev.deltaSize).toBe(10);
    expect(agg.size).toBe(0);
  });

  it("does not open a window when live equals committed", () => {
    const agg = new WindowAggregator(120_000);
    expect(agg.observe(W1, "ETH", pos(5), pos(5), T0)).toBe(false);
    expect(agg.size).toBe(0);
  });

  it("classifies on the NET change: scale in then partially out inside the window", () => {
    const agg = new WindowAggregator(120_000);
    agg.observe(W1, "ETH", pos(10), pos(20), T0);
    agg.observe(W1, "ETH", pos(10), pos(12), T0 + 30_000);
    const [w] = agg.flushExpired(T0 + 120_000);
    const ev = classify({ walletId: W1, coin: "ETH", prev: w!.prev, next: w!.next, windowStart: w!.windowStart, windowEnd: w!.windowEnd })!;
    expect(ev.eventType).toBe("INCREASE");
    expect(ev.deltaSize).toBe(2);
  });

  it("round trip inside a window produces no event", () => {
    const agg = new WindowAggregator(120_000);
    agg.observe(W1, "ETH", pos(0), pos(5), T0);
    agg.observe(W1, "ETH", pos(0), pos(0), T0 + 10_000);
    const [w] = agg.flushExpired(T0 + 120_000);
    expect(w).toBeDefined();
    expect(classify({ walletId: W1, coin: "ETH", prev: w!.prev, next: w!.next, windowStart: w!.windowStart, windowEnd: w!.windowEnd })).toBeNull();
  });

  it("windows are independent per wallet+coin", () => {
    const agg = new WindowAggregator(120_000);
    agg.observe(W1, "ETH", pos(0), pos(1), T0);
    agg.observe(W1, "BTC", pos(0, { coin: "BTC" }), pos(1, { coin: "BTC" }), T0 + 60_000);
    agg.observe(W2, "ETH", pos(0), pos(1), T0 + 60_000);
    expect(agg.size).toBe(3);
    expect(agg.flushExpired(T0 + 120_000)).toHaveLength(1);
    expect(agg.flushExpired(T0 + 180_000)).toHaveLength(2);
  });

  it("a change arriving after flush opens a NEW window (next lifecycle event)", () => {
    const agg = new WindowAggregator(120_000);
    agg.observe(W1, "ETH", pos(0), pos(10), T0);
    agg.flushExpired(T0 + 120_000);
    agg.observe(W1, "ETH", pos(10), pos(0), T0 + 300_000);
    const [w] = agg.flushExpired(T0 + 420_000);
    expect(w!.prev.szi).toBe(10);
    expect(w!.next.szi).toBe(0);
  });

  it("flushAll drains everything regardless of age", () => {
    const agg = new WindowAggregator(120_000);
    agg.observe(W1, "ETH", pos(0), pos(1), T0);
    expect(agg.flushAll(T0 + 1000)).toHaveLength(1);
    expect(agg.size).toBe(0);
  });
});
