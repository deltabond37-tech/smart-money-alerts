import { TIME_ZONE } from "./env";

export function fmtTs(v: string | number | null | undefined): string {
  if (!v) return "—";
  const d = new Date(v);
  return new Intl.DateTimeFormat("en-GB", { timeZone: TIME_ZONE, month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(d);
}

export function fmtUsd(n: number | string | null | undefined): string {
  if (n === null || n === undefined || n === "") return "—";
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  const a = Math.abs(v);
  const s = a >= 1e6 ? `$${(a / 1e6).toFixed(2)}M` : a >= 1e3 ? `$${(a / 1e3).toFixed(1)}k` : `$${a.toFixed(0)}`;
  return v < 0 ? `-${s}` : s;
}

export function fmtNum(n: number | string | null | undefined, dp = 2): string {
  if (n === null || n === undefined || n === "") return "—";
  const v = Number(n);
  return Number.isFinite(v) ? v.toLocaleString("en-US", { maximumFractionDigits: dp }) : "—";
}

export function fmtPct(n: number | string | null | undefined): string {
  if (n === null || n === undefined || n === "") return "—";
  const v = Number(n);
  return Number.isFinite(v) ? `${v.toFixed(1)}%` : "—";
}

export const short = (a: string) => (a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);

export function ago(v: string | number | null | undefined): string {
  if (!v) return "never";
  const s = Math.max(0, Math.round((Date.now() - new Date(v).getTime()) / 1000));
  if (s < 90) return `${s}s ago`;
  if (s < 5400) return `${Math.round(s / 60)}m ago`;
  if (s < 172800) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}
