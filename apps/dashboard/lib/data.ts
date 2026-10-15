import type { AlertRule, CoinTier, Wallet } from "@sma/core";
import { createClient } from "./supabase/server";

/* eslint-disable @typescript-eslint/no-explicit-any */
export type Row = Record<string, any>;

function must<T>(res: { data: T; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data;
}

export async function getWallets(): Promise<Row[]> {
  const sb = await createClient();
  return must(await sb.from("wallets").select("*, wallet_state(*)").order("created_at"), "wallets") as Row[];
}

export function toWallet(r: Row): Wallet {
  return {
    id: r.id,
    address: String(r.address).toLowerCase(),
    label: r.label,
    tier: r.tier,
    venue: r.venue,
    isActive: !!r.is_active,
    isPriority: !!r.is_priority,
    muted: !!r.muted,
    overrides: r.overrides ?? {},
  };
}

export async function getRules(): Promise<Row[]> {
  const sb = await createClient();
  return must(await sb.from("alert_rules").select("*").order("scope").order("scope_ref"), "alert_rules") as Row[];
}

export function toRule(r: Row): AlertRule {
  return { scope: r.scope, scopeRef: r.scope_ref ?? null, eventTypes: r.event_types ?? [], thresholds: r.thresholds ?? {}, routing: r.routing ?? {}, enabled: !!r.enabled };
}

export async function getCoinTiers(): Promise<Record<string, CoinTier>> {
  const sb = await createClient();
  const rows = must(await sb.from("coin_tiers").select("coin,tier").order("coin"), "coin_tiers") as Row[];
  const out: Record<string, CoinTier> = {};
  for (const r of rows) out[r.coin] = r.tier;
  return out;
}

export interface EventFilters {
  wallet?: string;
  coin?: string;
  type?: string;
  status?: "alerted" | "filtered" | "";
  reason?: string;
  minScore?: number;
  days?: number;
  limit?: number;
}

export async function getEvents(f: EventFilters): Promise<Row[]> {
  const sb = await createClient();
  let q = sb.from("position_events").select("*, wallets(label,tier,address)").order("window_end", { ascending: false }).limit(f.limit ?? 200);
  if (f.wallet) q = q.eq("wallet_id", f.wallet);
  if (f.coin) q = q.eq("coin", f.coin.toUpperCase());
  if (f.type) q = q.eq("event_type", f.type);
  if (f.status === "alerted") q = q.eq("filtered", false);
  if (f.status === "filtered") q = q.eq("filtered", true);
  if (f.reason) q = q.eq("filter_reason", f.reason);
  if (f.minScore) q = q.gte("score", f.minScore);
  if (f.days) q = q.gte("window_end", new Date(Date.now() - f.days * 86400_000).toISOString());
  return must(await q, "position_events") as Row[];
}

export async function getClusters(limit = 100): Promise<Row[]> {
  const sb = await createClient();
  return must(await sb.from("cluster_alerts").select("*").order("created_at", { ascending: false }).limit(limit), "cluster_alerts") as Row[];
}

export async function getHealth() {
  const sb = await createClient();
  const since24h = new Date(Date.now() - 86400_000).toISOString();
  const [hb, failed, events, alerts] = await Promise.all([
    sb.from("worker_heartbeats").select("*").order("updated_at", { ascending: false }),
    sb.from("alerts_sent").select("*, position_events(coin,event_type,wallet_id)").in("status", ["failed", "posting"]).gte("created_at", since24h).order("created_at", { ascending: false }).limit(50),
    sb.from("position_events").select("channel,filtered,filter_reason").gte("created_at", since24h),
    sb.from("alerts_sent").select("channel,status").gte("created_at", since24h),
  ]);
  return {
    heartbeats: must(hb, "heartbeats") as Row[],
    failedAlerts: must(failed, "failed alerts") as Row[],
    events24h: must(events, "events") as Row[],
    alerts24h: must(alerts, "alerts") as Row[],
  };
}
