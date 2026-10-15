import type { Cluster } from "../cluster.js";
import type { Decision, EventType, PositionEvent, Side, Wallet } from "../types.js";

// Minimal Block Kit typings (avoids a hard dependency on @slack/types in core).
export type Block = { type: string; [k: string]: unknown };
export interface SlackMessage {
  text: string;
  blocks: Block[];
}

export interface FormatContext {
  timeZone?: string;
  explorerUrl?: (address: string) => string;
  hypurrscanUrl?: (address: string) => string;
}

const DEFAULT_CTX: Required<FormatContext> = {
  timeZone: "Asia/Kolkata",
  explorerUrl: (a) => `https://app.hyperliquid.xyz/explorer/address/${a}`,
  hypurrscanUrl: (a) => `https://hypurrscan.io/address/${a}`,
};

export const EVENT_EMOJI: Record<EventType, string> = {
  OPEN: "🟢",
  CLOSE: "✅",
  INCREASE: "➕",
  DECREASE: "➖",
  FLIP: "🔄",
};

export function headerLabel(ev: Pick<PositionEvent, "eventType" | "side">): string {
  const side = ev.side.toUpperCase();
  switch (ev.eventType) {
    case "OPEN":
      return `${ev.side === "long" ? "🟢" : "🔴"} OPEN ${side}`;
    case "CLOSE":
      return `✅ CLOSE ${side}`;
    case "INCREASE":
      return `➕ INCREASE ${side}`;
    case "DECREASE":
      return `➖ DECREASE ${side}`;
    case "FLIP":
      return `🔄 FLIP → ${side}`;
  }
}

export function shortAddr(a: string): string {
  return a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}

export function fmtUsd(n: number | null | undefined, opts: { sign?: boolean } = {}): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  const s = abs >= 1_000_000 ? `$${(abs / 1_000_000).toFixed(2)}M` : abs >= 1_000 ? `$${(abs / 1_000).toFixed(1)}k` : `$${abs.toFixed(0)}`;
  if (opts.sign) return n < 0 ? `-${s}` : `+${s}`;
  return n < 0 ? `-${s}` : s;
}

export function fmtNum(n: number | null | undefined, dp = 4): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  const d = abs >= 1000 ? 2 : abs >= 1 ? Math.min(dp, 4) : dp;
  return n.toLocaleString("en-US", { maximumFractionDigits: d });
}

export function fmtPct(n: number | null | undefined, dp = 1): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return `${n.toFixed(dp)}%`;
}

export function fmtTime(ms: number, timeZone: string): string {
  const d = new Date(ms);
  const date = new Intl.DateTimeFormat("en-GB", { timeZone, year: "numeric", month: "short", day: "2-digit" }).format(d);
  const time = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(d);
  const tzLabel = timeZone === "Asia/Kolkata" ? "IST" : timeZone;
  return `${date} ${time} ${tzLabel}`;
}

const field = (label: string, value: string): Block => ({ type: "mrkdwn", text: `*${label}*\n${value}` });

export interface EventFormatInput {
  event: PositionEvent;
  wallet: Pick<Wallet, "address" | "label" | "tier">;
  decision: Pick<Decision, "score" | "components">;
  /** true when this is a thread reply (adds a compact prefix) */
  isThreadReply?: boolean;
}

export function formatEventMessage(input: EventFormatInput, ctx: FormatContext = {}): SlackMessage {
  const c = { ...DEFAULT_CTX, ...ctx };
  const { event: ev, wallet, decision } = input;
  const title = `${headerLabel(ev)} ${ev.coin} · ${wallet.label} · score ${decision.score}`;
  const sign = ev.deltaSize >= 0 ? "+" : "";
  const pnlLabel = ev.eventType === "CLOSE" || ev.eventType === "DECREASE" || ev.eventType === "FLIP" ? "Realized PnL" : "uPnL";
  const pnlValue = pnlLabel === "uPnL" ? fmtUsd(ev.unrealizedPnl, { sign: true }) : fmtUsd(ev.realizedPnl, { sign: true });

  const fields: Block[] = [
    field("Δ size / Δ notional", `${sign}${fmtNum(ev.deltaSize)} ${ev.coin} / ${fmtUsd(ev.deltaNotionalUsd)}`),
    field("New position", `${fmtNum(ev.s1)} ${ev.coin} (${fmtUsd(ev.newNotionalUsd)})`),
    field("% of equity", fmtPct(ev.equityPct)),
    field("Leverage", ev.leverage === null ? "—" : `${fmtNum(ev.leverage, 1)}x`),
    field("Avg fill / entry px", `${fmtNum(ev.avgFillPx)} / ${fmtNum(ev.entryPx)}`),
    field("Mark px", fmtNum(ev.markPx)),
    field("Liq px", fmtNum(ev.liqPx)),
    field(pnlLabel, pnlValue),
    field("% change", ev.pctChange === null ? "new" : fmtPct(ev.pctChange)),
    field("Wallet tier", `${wallet.tier}  ·  fills: ${ev.fillCount}${ev.takerRatio !== null ? ` (${fmtPct(ev.takerRatio * 100, 0)} taker)` : ""}`),
  ];

  const comp = decision.components;
  const scoreLine = `score ${decision.score} = size ${comp.size_z}${comp.z !== null ? ` (z ${comp.z})` : " (abs)"} + equity ${comp.equity_pct} + tier ${comp.tier} + type ${comp.event_type} + confluence ${comp.confluence}`;

  const blocks: Block[] = [
    { type: "header", text: { type: "plain_text", text: title.slice(0, 150), emoji: true } },
    { type: "section", fields },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `\`${shortAddr(wallet.address)}\` · <${c.explorerUrl(wallet.address)}|HL explorer> · <${c.hypurrscanUrl(wallet.address)}|Hypurrscan> · ${fmtTime(ev.windowEnd, c.timeZone)}`,
        },
      ],
    },
    { type: "context", elements: [{ type: "mrkdwn", text: scoreLine }] },
  ];

  return { text: title, blocks };
}

export interface ClusterFormatInput {
  cluster: Cluster;
  wallets: Array<Pick<Wallet, "id" | "label" | "tier" | "address">>;
  /** total Δnotional across the cluster's events, if known */
  totalNotionalUsd?: number;
  k: number;
  tMin: number;
}

export function formatClusterMessage(input: ClusterFormatInput, ctx: FormatContext = {}): SlackMessage {
  const c = { ...DEFAULT_CTX, ...ctx };
  const { cluster } = input;
  const dir = cluster.direction.toUpperCase();
  const title = `🚨 CLUSTER ${dir} ${cluster.coin} · ${cluster.walletIds.length} wallets`;
  const walletsById = new Map(input.wallets.map((w) => [w.id, w]));
  const list = cluster.walletIds
    .map((id) => walletsById.get(id))
    .map((w) => (w ? `• *${w.label}* (${w.tier}) \`${shortAddr(w.address)}\`` : "• unknown"))
    .join("\n");
  const spanMin = Math.max(1, Math.round((cluster.windowEnd - cluster.windowStart) / 60_000));

  return {
    text: title,
    blocks: [
      { type: "header", text: { type: "plain_text", text: title.slice(0, 150), emoji: true } },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `${cluster.walletIds.length} tracked wallets went *${dir} ${cluster.coin}* within ${spanMin} min (rule: ≥${input.k} in ${input.tMin} min)${input.totalNotionalUsd !== undefined ? ` · combined ${fmtUsd(input.totalNotionalUsd)}` : ""}\n${list}`,
        },
      },
      {
        type: "context",
        elements: [{ type: "mrkdwn", text: `${fmtTime(cluster.windowStart, c.timeZone)} → ${fmtTime(cluster.windowEnd, c.timeZone)}` }],
      },
    ],
  };
}

export function formatClusterJoinReply(wallet: Pick<Wallet, "label" | "tier" | "address">, side: Side, coin: string, deltaNotionalUsd: number): SlackMessage {
  const text = `➕ *${wallet.label}* (${wallet.tier}) joined ${side.toUpperCase()} ${coin} · ${fmtUsd(deltaNotionalUsd)}`;
  return { text, blocks: [{ type: "section", text: { type: "mrkdwn", text } }] };
}

export function formatOpsMessage(level: "info" | "warn" | "error", title: string, details: Record<string, unknown> = {}): SlackMessage {
  const emoji = level === "error" ? "🔥" : level === "warn" ? "⚠️" : "ℹ️";
  const lines = Object.entries(details).map(([k, v]) => `• *${k}*: ${typeof v === "string" ? v : JSON.stringify(v)}`);
  const text = `${emoji} ${title}`;
  return {
    text,
    blocks: [
      { type: "section", text: { type: "mrkdwn", text: `${emoji} *${title}*${lines.length ? `\n${lines.join("\n")}` : ""}` } },
    ],
  };
}

export function formatTestMessage(channelKey: string, sentBy = "dashboard"): SlackMessage {
  const text = `🧪 Smart Money Alerts test message for *${channelKey}* (sent from ${sentBy})`;
  return { text, blocks: [{ type: "section", text: { type: "mrkdwn", text } }] };
}
