import { describe, expect, it } from "vitest";
import { resolveRules } from "@sma/core";
import { ADDR, FakeAdapter, FakeSlack, makeWorld, pos, T0, wallet } from "./harness.js";
import { MemoryRepo } from "./memoryRepo.js";

describe("worker end-to-end (in-memory repo, fake venue, fake slack)", () => {
  it("baselines a new wallet without alerting on pre-existing positions", async () => {
    const w = await makeWorld({ wallets: [wallet(1)] });
    w.adapter.set(ADDR(1), [pos("ETH", 50)]);
    await w.poll();
    await w.tick(200_000);
    expect(w.repo.events.size).toBe(0);
    expect(w.slack.posts).toHaveLength(0);
    expect(w.repo.snapshots.get("w1:ETH")?.state.szi).toBe(50);
  });

  it("acceptance: scaling into a position over 10 fills in 2 minutes -> exactly ONE alert", async () => {
    const w = await makeWorld({ wallets: [wallet(1)] });
    w.adapter.set(ADDR(1), []);
    await w.poll(); // baseline (flat)
    for (let i = 1; i <= 10; i++) {
      w.adapter.set(ADDR(1), [pos("ETH", i * 2)]); // +2 ETH each 12s = $6k per fill, $60k total
      w.adapter.addFill(ADDR(1), { coin: "ETH", sz: 2, time: w.clock.now + 12_000 });
      await w.tick(12_000);
    }
    expect(w.slack.posts).toHaveLength(0); // window still open
    await w.tick(120_000);
    expect(w.repo.events.size).toBe(1);
    const ev = [...w.repo.events.values()][0]!;
    expect(ev.eventType).toBe("OPEN");
    expect(ev.deltaSize).toBe(20);
    expect(ev.fillCount).toBe(10);
    expect(ev.filtered).toBe(false);
    expect(w.slack.posts).toHaveLength(1);
    expect(w.slack.posts[0]!.text).toContain("OPEN LONG ETH");
    expect(w.slack.posts[0]!.opts.threadTs).toBeUndefined();
    expect(w.repo.threads).toHaveLength(1);
    expect(w.repo.threads[0]!.closedAt).toBeNull();
  });

  it("acceptance: restart mid-position -> no duplicate alert; later CLOSE threads under the original OPEN", async () => {
    const repo = new MemoryRepo();
    const adapter = new FakeAdapter();
    const slack = new FakeSlack();
    const clock = { now: T0 };

    const a = await makeWorld({ repo, adapter, slack, clock, wallets: [wallet(1)] });
    adapter.set(ADDR(1), []);
    await a.poll();
    adapter.set(ADDR(1), [pos("ETH", 20)]);
    await a.tick(10_000);
    await a.tick(130_000); // OPEN flushed + posted
    expect(slack.posts).toHaveLength(1);
    const openTs = slack.posts[0]!.opts.threadTs ?? repo.threads[0]!.threadTs;

    // position unchanged; "restart": new world on the same repo
    const b = await makeWorld({ repo, adapter, slack, clock, wallets: [wallet(1)] });
    await b.poll();
    await b.tick(130_000);
    expect(repo.events.size).toBe(1); // no duplicate event
    expect(slack.posts).toHaveLength(1); // no duplicate alert

    // close the position after restart, with a realized pnl fill
    adapter.set(ADDR(1), []);
    adapter.addFill(ADDR(1), { coin: "ETH", sz: 20, side: "A", dir: "Close Long", closedPnl: 12_000, time: clock.now + 5_000 });
    await b.tick(10_000);
    await b.tick(130_000);
    expect(repo.events.size).toBe(2);
    const close = [...repo.events.values()].find((e) => e.eventType === "CLOSE")!;
    expect(close.realizedPnl).toBe(12_000);
    expect(slack.posts).toHaveLength(2);
    expect(slack.posts[1]!.opts.threadTs).toBe(openTs);
    expect(slack.posts[1]!.text).toContain("CLOSE LONG ETH");
    expect(repo.threads[0]!.closedAt).not.toBeNull();
    expect(close.lifecycleId).toBe(repo.threads[0]!.lifecycleId);
  });

  it("restart while a window is open: the change is re-derived from the snapshot and alerted once", async () => {
    const repo = new MemoryRepo();
    const adapter = new FakeAdapter();
    const slack = new FakeSlack();
    const clock = { now: T0 };
    const a = await makeWorld({ repo, adapter, slack, clock, wallets: [wallet(1)] });
    adapter.set(ADDR(1), []);
    await a.poll();
    adapter.set(ADDR(1), [pos("ETH", 20)]);
    await a.tick(10_000); // window opens in memory, process "dies" before flush
    const b = await makeWorld({ repo, adapter, slack, clock, wallets: [wallet(1)] });
    await b.poll();
    await b.tick(130_000);
    expect(repo.events.size).toBe(1);
    expect(slack.posts).toHaveLength(1);
  });

  it("acceptance: $2k change on a wallet that normally trades $500k is logged as filtered, not posted", async () => {
    const w = await makeWorld({ wallets: [wallet(1)], thresholds: { min_delta_notional_usd: 25_000 } });
    w.adapter.set(ADDR(1), []);
    await w.poll();
    // build history: five ~$500k opens/closes with some variance
    for (let i = 0; i < 5; i++) {
      w.adapter.set(ADDR(1), [pos("ETH", 150 + i * 8)]);
      await w.tick(10_000);
      await w.tick(130_000);
      w.adapter.set(ADDR(1), []);
      await w.tick(10_000);
      await w.tick(130_000);
      await w.tick(31 * 60_000); // past cooldown
    }
    const before = w.slack.posts.length;
    w.adapter.set(ADDR(1), [pos("ETH", 166.67)]);
    await w.tick(10_000);
    await w.tick(130_000);
    w.adapter.set(ADDR(1), [pos("ETH", 167.34)]); // +0.67 ETH = $2k
    await w.tick(10_000);
    await w.tick(130_000);
    const ev = [...w.repo.events.values()].at(-1)!;
    expect(ev.eventType).toBe("INCREASE");
    expect(ev.filtered).toBe(true);
    expect(["dust", "min_delta_notional"]).toContain(ev.filterReason);
    expect(ev.components.z).toBeLessThan(-1);
    expect(w.slack.posts.length).toBe(before + 1); // only the $500k open posted
  });

  it("acceptance: 3 tracked wallets opening the same coin long within an hour -> CLUSTER alert, 4th joins thread", async () => {
    const wallets = [wallet(1), wallet(2), wallet(3), wallet(4)];
    const w = await makeWorld({ wallets });
    for (const x of wallets) w.adapter.set(x.address, []);
    await w.poll();
    for (let i = 1; i <= 3; i++) {
      w.adapter.set(ADDR(i), [pos("SOL", 500, 150)]); // $75k each
      await w.tick(10_000);
      await w.tick(130_000);
      await w.tick(5 * 60_000);
    }
    const clusterPosts = w.slack.posts.filter((p) => p.channel === "#clusters");
    expect(clusterPosts).toHaveLength(1);
    expect(clusterPosts[0]!.text).toBe("🚨 CLUSTER LONG SOL · 3 wallets");
    expect(w.repo.clusters).toHaveLength(1);
    expect(w.repo.clusters[0]!.walletIds).toHaveLength(3);

    w.adapter.set(ADDR(4), [pos("SOL", 500, 150)]);
    await w.tick(10_000);
    await w.tick(130_000);
    const after = w.slack.posts.filter((p) => p.channel === "#clusters");
    expect(after).toHaveLength(2);
    expect(after[1]!.opts.threadTs).toBe(w.repo.clusters[0]!.threadTs);
    expect(w.repo.clusters[0]!.walletIds).toHaveLength(4);
    // the 3rd wallet's own event got a confluence bonus
    const third = [...w.repo.events.values()].filter((e) => e.walletId === "w3")[0]!;
    expect(third.components.confluence).toBe(10);
  });

  it("FLIP closes the old lifecycle and starts a new thread; INCREASE replies in-thread with broadcast when score is high", async () => {
    const w = await makeWorld({ wallets: [wallet(1)], thresholds: { thread_broadcast_min_score: 30 } });
    w.adapter.set(ADDR(1), []);
    await w.poll();
    w.adapter.set(ADDR(1), [pos("ETH", 20)]);
    await w.tick(10_000);
    await w.tick(130_000);
    w.adapter.set(ADDR(1), [pos("ETH", 40)]);
    await w.tick(31 * 60_000); // past cooldown
    await w.tick(130_000);
    expect(w.slack.posts).toHaveLength(2);
    expect(w.slack.posts[1]!.opts.threadTs).toBe(w.repo.threads[0]!.threadTs);
    expect(w.slack.posts[1]!.opts.replyBroadcast).toBe(true);
    w.adapter.set(ADDR(1), [pos("ETH", -10)]);
    await w.tick(10_000);
    await w.tick(130_000);
    expect(w.slack.posts).toHaveLength(3);
    expect(w.slack.posts[2]!.text).toContain("FLIP → SHORT");
    expect(w.slack.posts[2]!.opts.threadTs).toBeUndefined();
    expect(w.repo.threads).toHaveLength(2);
    expect(w.repo.threads[0]!.closedAt).not.toBeNull();
    expect(w.repo.threads[1]!.closedAt).toBeNull();
  });

  it("cooldown: a second INCREASE within 30 min is logged as filtered", async () => {
    const w = await makeWorld({ wallets: [wallet(1)] });
    w.adapter.set(ADDR(1), []);
    await w.poll();
    w.adapter.set(ADDR(1), [pos("ETH", 20)]);
    await w.tick(10_000);
    await w.tick(130_000);
    w.adapter.set(ADDR(1), [pos("ETH", 40)]);
    await w.tick(60_000);
    await w.tick(130_000);
    const inc = [...w.repo.events.values()].find((e) => e.eventType === "INCREASE")!;
    expect(inc.filterReason).toBe("cooldown");
    expect(w.slack.posts).toHaveLength(1);
  });

  it("slack failure is recorded in alerts_sent and does not stop processing", async () => {
    const w = await makeWorld({ wallets: [wallet(1)] });
    w.adapter.set(ADDR(1), []);
    await w.poll();
    w.slack.failNext = 1;
    w.adapter.set(ADDR(1), [pos("ETH", 20)]);
    await w.tick(10_000);
    await w.tick(130_000);
    expect(w.repo.alerts[0]!.status).toBe("failed");
    expect(w.repo.events.size).toBe(1);
    expect(w.repo.snapshots.get("w1:ETH")?.state.szi).toBe(20);
  });

  it("resume: pending alerts are re-posted, posting alerts are failed and reported to ops", async () => {
    const w = await makeWorld({ wallets: [wallet(1)] });
    w.adapter.set(ADDR(1), []);
    await w.poll();
    w.adapter.set(ADDR(1), [pos("ETH", 20)]);
    await w.tick(10_000);
    await w.tick(130_000);
    const ev = [...w.repo.events.values()][0]!;
    w.repo.alerts[0]!.status = "posting";
    const pending = await w.repo.createAlert({ eventId: ev.id, clusterId: null, channel: "#feed" });
    await w.alerter.resume(new Map([["w1", wallet(1)]]), (x, coin) => resolveRules(w.config.current, x, coin));
    expect(w.repo.alerts.find((a) => a.id === pending.id)!.status).toBe("failed");
    expect(w.slack.posts.some((p) => p.channel === "#ops")).toBe(true);
    expect(w.slack.posts.filter((p) => p.channel !== "#ops")).toHaveLength(2); // original + resumed
  });
});
