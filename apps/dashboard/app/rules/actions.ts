"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { replay, type AlertRule, type ReplayEvent, type ReplayResult } from "@sma/core";
import { getCoinTiers, getRules, getWallets, toRule, toWallet, type Row } from "@/lib/data";
import { parseRuleForm } from "@/lib/ruleForm";
import { createClient } from "@/lib/supabase/server";

function fail(msg: string): never {
  redirect(`/rules?error=${encodeURIComponent(msg)}`);
}

export async function saveRule(formData: FormData): Promise<void> {
  let parsed;
  try {
    parsed = parseRuleForm(formData);
  } catch (e) {
    fail(e instanceof Error ? e.message : "Invalid rule");
  }
  if (parsed.scope !== "global" && !parsed.scopeRef) fail("Scope reference (wallet address or coin tier) is required");
  const id = String(formData.get("id") ?? "");
  const sb = await createClient();
  const row = {
    scope: parsed.scope,
    scope_ref: parsed.scopeRef,
    name: parsed.name,
    event_types: parsed.eventTypes,
    thresholds: parsed.thresholds,
    routing: parsed.routing,
    enabled: parsed.enabled,
  };
  const { error } = id ? await sb.from("alert_rules").update(row).eq("id", id) : await sb.from("alert_rules").insert(row);
  if (error) fail(error.message);
  revalidatePath("/rules");
  redirect("/rules?ok=Rule%20saved.%20The%20worker%20picks%20it%20up%20within%2060s.");
}

export async function deleteRule(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  const sb = await createClient();
  const { error } = await sb.from("alert_rules").delete().eq("id", id).neq("scope", "global");
  if (error) fail(error.message);
  revalidatePath("/rules");
  redirect("/rules?ok=Rule%20deleted");
}

export async function saveCoinTiers(formData: FormData): Promise<void> {
  const text = String(formData.get("tiers") ?? "");
  const rows: Array<{ coin: string; tier: string }> = [];
  for (const line of text.split(/\r?\n/)) {
    const [coin, tier] = line.split(/[,:\s]+/).map((s) => s?.trim());
    if (!coin) continue;
    if (!["major", "mid", "long_tail"].includes(tier ?? "")) fail(`Bad tier for ${coin}: use major | mid | long_tail`);
    rows.push({ coin: coin.toUpperCase(), tier: tier! });
  }
  const sb = await createClient();
  const { error: delErr } = await sb.from("coin_tiers").delete().neq("coin", "");
  if (delErr) fail(delErr.message);
  if (rows.length) {
    const { error } = await sb.from("coin_tiers").upsert(rows, { onConflict: "coin" });
    if (error) fail(error.message);
  }
  revalidatePath("/rules");
  redirect("/rules?ok=Coin%20tiers%20saved");
}

export interface TestRuleResult {
  ok: true;
  result: Omit<ReplayResult, "decisions">;
  perChannel: Record<string, number>;
  days: number;
}
export interface TestRuleError {
  ok: false;
  error: string;
}

/**
 * "Test rule": replay the last N days of stored events through the CURRENT rule set with the edited rule
 * swapped in (unsaved), and count how many alerts would have fired per channel.
 */
export async function testRule(_prev: TestRuleResult | TestRuleError | null, formData: FormData): Promise<TestRuleResult | TestRuleError> {
  try {
    const parsed = parseRuleForm(formData);
    const days = Math.min(30, Math.max(1, Number(formData.get("days") ?? 7)));
    const [ruleRows, walletRows, coinTiers] = await Promise.all([getRules(), getWallets(), getCoinTiers()]);
    const id = String(formData.get("id") ?? "");
    const rules: AlertRule[] = ruleRows.filter((r: Row) => r.id !== id).map(toRule);
    rules.push({ scope: parsed.scope, scopeRef: parsed.scopeRef, eventTypes: parsed.eventTypes, thresholds: parsed.thresholds, routing: parsed.routing, enabled: parsed.enabled });
    const wallets = walletRows.map(toWallet);
    const mmById = new Map<string, boolean>(walletRows.map((w: Row) => [w.id, (Array.isArray(w.wallet_state) ? w.wallet_state[0] : w.wallet_state)?.auto_flags?.mm === true]));

    const sb = await createClient();
    const { data, error } = await sb
      .from("position_events")
      .select("*")
      .gte("window_end", new Date(Date.now() - days * 86400_000).toISOString())
      .order("window_end")
      .limit(5000);
    if (error) return { ok: false, error: error.message };
    const events: ReplayEvent[] = (data as Row[]).map((r) => ({
      id: r.id,
      walletId: r.wallet_id,
      coin: r.coin,
      eventType: r.event_type,
      side: r.side,
      windowStart: new Date(r.window_start).getTime(),
      windowEnd: new Date(r.window_end).getTime(),
      s0: Number(r.s0),
      s1: Number(r.s1),
      deltaSize: Number(r.delta_size),
      deltaNotionalUsd: Number(r.delta_notional_usd),
      pctChange: r.pct_change === null ? null : Number(r.pct_change),
      newNotionalUsd: Number(r.new_notional_usd),
      equityPct: r.equity_pct === null ? null : Number(r.equity_pct),
      leverage: r.leverage === null ? null : Number(r.leverage),
      entryPx: r.entry_px === null ? null : Number(r.entry_px),
      avgFillPx: r.avg_fill_px === null ? null : Number(r.avg_fill_px),
      markPx: r.mark_px === null ? null : Number(r.mark_px),
      liqPx: r.liq_px === null ? null : Number(r.liq_px),
      unrealizedPnl: r.unrealized_pnl === null ? null : Number(r.unrealized_pnl),
      realizedPnl: r.realized_pnl === null ? null : Number(r.realized_pnl),
      fillCount: Number(r.fill_count ?? 0),
      takerRatio: r.taker_ratio === null ? null : Number(r.taker_ratio),
      mmFlagged: mmById.get(r.wallet_id) ?? false,
    }));

    const result = replay(events, { rules, coinTiers }, wallets);
    const perChannel: Record<string, number> = {};
    for (const d of result.decisions) {
      if (!d.decision.filtered && d.decision.channel) {
        const { routing } = { routing: parsed.routing };
        const name = routing[d.decision.channel] ?? (d.decision.channel === "high" ? process.env.SLACK_CHANNEL_HIGH ?? "#sm-high-conviction" : process.env.SLACK_CHANNEL_FEED ?? "#sm-feed");
        perChannel[name] = (perChannel[name] ?? 0) + 1;
      }
    }
    const { decisions: _d, ...rest } = result;
    return { ok: true, result: rest, perChannel, days };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
