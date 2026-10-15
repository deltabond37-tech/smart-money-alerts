// Read-only smoke test against the public Hyperliquid API.
//   pnpm smoke 0x<address> [hoursOfFills=24]
import pino from "pino";
import { DEFAULT_THRESHOLDS, isLikelyMarketMaker, marketMakerStats, TokenBucket } from "@sma/core";
import { HlInfoClient } from "../src/adapters/hyperliquid/client.js";
import { HyperliquidAdapter } from "../src/adapters/hyperliquid/HyperliquidAdapter.js";

const address = process.argv[2]?.toLowerCase();
const hours = Number(process.argv[3] ?? 24);
if (!address) throw new Error("usage: pnpm smoke 0x<address> [hours]");

const log = pino({ level: "warn" });
const bucket = new TokenBucket(800);
const client = new HlInfoClient({ baseUrl: process.env.HL_API_URL ?? "https://api.hyperliquid.xyz", bucket, log });
const adapter = new HyperliquidAdapter(client, log);

const marks = await adapter.getMarkPrices();
const snap = await adapter.getPositions(address, marks);
console.log(`account value: $${snap.accountValue?.toLocaleString()}  positions: ${snap.positions.length}`);
for (const p of snap.positions) {
  console.log(`  ${p.coin.padEnd(8)} szi=${p.szi} mark=${p.markPx} entry=${p.entryPx} lev=${p.leverage}x liq=${p.liqPx} uPnL=${p.unrealizedPnl?.toFixed(0)} notional=$${p.positionValue?.toFixed(0)}`);
}
const fills = await adapter.getFills(address, Date.now() - hours * 3600_000);
const s = marketMakerStats(fills, hours);
console.log(`fills last ${hours}h: ${fills.length}  fills/day=${s.fillsPerDay.toFixed(0)}  drift=${s.driftRatio.toFixed(3)}  mm=${isLikelyMarketMaker(s, DEFAULT_THRESHOLDS.mm)}`);
console.log(`budget used this minute: ${bucket.usedThisMinute()}`);
