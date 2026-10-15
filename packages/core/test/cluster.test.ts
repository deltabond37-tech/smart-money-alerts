import { describe, expect, it } from "vitest";
import { confluenceCount, detectClusters, type ClusterCandidate } from "../src/cluster.js";
import { T0, W1, W2, W3 } from "./helpers.js";

const c = (o: Partial<ClusterCandidate>): ClusterCandidate => ({
  eventId: Math.random().toString(36).slice(2),
  walletId: W1,
  coin: "SOL",
  side: "long",
  eventType: "OPEN",
  at: T0,
  ...o,
});

describe("detectClusters", () => {
  it("acceptance: 3 tracked wallets opening the same coin long within an hour -> one CLUSTER", () => {
    const events = [
      c({ walletId: W1, at: T0 }),
      c({ walletId: W2, at: T0 + 20 * 60_000, eventType: "INCREASE" }),
      c({ walletId: W3, at: T0 + 55 * 60_000 }),
    ];
    const clusters = detectClusters(events, 3, 60);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]).toMatchObject({ coin: "SOL", direction: "long", windowStart: T0, windowEnd: T0 + 55 * 60_000 });
    expect(clusters[0]!.walletIds.sort()).toEqual([W1, W2, W3].sort());
  });

  it("same wallet repeating does not count as distinct", () => {
    expect(detectClusters([c({ walletId: W1 }), c({ walletId: W1, at: T0 + 1000 }), c({ walletId: W2 })], 3, 60)).toHaveLength(0);
  });

  it("direction and coin must match; DECREASE/CLOSE/FLIP are ignored", () => {
    const events = [
      c({ walletId: W1 }),
      c({ walletId: W2, side: "short" }),
      c({ walletId: W3, coin: "ETH" }),
      c({ walletId: W3, eventType: "CLOSE" }),
    ];
    expect(detectClusters(events, 2, 60)).toHaveLength(0);
  });

  it("events outside the T-minute span do not cluster", () => {
    const events = [c({ walletId: W1, at: T0 }), c({ walletId: W2, at: T0 + 61 * 60_000 }), c({ walletId: W3, at: T0 + 130 * 60_000 })];
    expect(detectClusters(events, 2, 60)).toHaveLength(0);
    expect(detectClusters(events, 2, 70)).toHaveLength(1);
  });

  it("confluenceCount counts OTHER wallets only", () => {
    const events = [c({ walletId: W1 }), c({ walletId: W2, at: T0 + 10 * 60_000 }), c({ walletId: W3, at: T0 - 10 * 60_000, side: "short" })];
    expect(confluenceCount(events, W1, "SOL", "long", T0, 60)).toBe(1);
    expect(confluenceCount(events, W2, "SOL", "long", T0, 60)).toBe(1);
    expect(confluenceCount(events, W3, "SOL", "short", T0, 60)).toBe(0);
  });
});
