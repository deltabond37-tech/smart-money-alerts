import type { ReactNode } from "react";

export function Card({ title, children, actions }: { title?: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
      {(title || actions) && (
        <div className="mb-3 flex items-center justify-between">
          {title && <h2 className="text-sm font-semibold text-zinc-200">{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function Button({ children, variant = "default", className = "", ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "default" | "primary" | "danger" | "ghost" }) {
  const base = "rounded px-2.5 py-1 text-xs font-medium disabled:opacity-50";
  const v = {
    default: "bg-zinc-800 hover:bg-zinc-700 text-zinc-100",
    primary: "bg-emerald-600 hover:bg-emerald-500 text-white",
    danger: "bg-red-900/60 hover:bg-red-800 text-red-100",
    ghost: "hover:bg-zinc-800 text-zinc-300",
  }[variant];
  return (
    <button className={`${base} ${v} ${className}`} {...rest}>
      {children}
    </button>
  );
}

export function Badge({ children, tone = "zinc" }: { children: ReactNode; tone?: "zinc" | "green" | "red" | "amber" | "blue" | "purple" }) {
  const t = {
    zinc: "bg-zinc-800 text-zinc-300",
    green: "bg-emerald-900/60 text-emerald-300",
    red: "bg-red-900/60 text-red-300",
    amber: "bg-amber-900/60 text-amber-300",
    blue: "bg-sky-900/60 text-sky-300",
    purple: "bg-purple-900/60 text-purple-300",
  }[tone];
  return <span className={`inline-block rounded px-1.5 py-0.5 text-[11px] font-medium ${t}`}>{children}</span>;
}

export function Notice({ kind, children }: { kind: "ok" | "error" | "info"; children: ReactNode }) {
  const c = kind === "ok" ? "border-emerald-800 bg-emerald-950/40 text-emerald-200" : kind === "error" ? "border-red-800 bg-red-950/40 text-red-200" : "border-sky-800 bg-sky-950/40 text-sky-200";
  return <div className={`rounded border px-3 py-2 text-sm ${c}`}>{children}</div>;
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="rounded border border-zinc-800 bg-zinc-900/40 px-3 py-2">
      <div className="text-[11px] uppercase tracking-wide text-zinc-500">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
      {hint && <div className="text-[11px] text-zinc-500">{hint}</div>}
    </div>
  );
}

export const EVENT_TONE: Record<string, "green" | "red" | "amber" | "blue" | "purple"> = { OPEN: "green", CLOSE: "blue", INCREASE: "green", DECREASE: "amber", FLIP: "purple" };
