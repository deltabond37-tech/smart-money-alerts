"use client";
import { useActionState } from "react";
import { Button } from "@/components/ui";
import { NUMBER_FIELDS, getPath } from "@/lib/ruleFields";
import { saveRule, deleteRule, testRule, type TestRuleError, type TestRuleResult } from "./actions";

const EVENT_TYPES = ["OPEN", "CLOSE", "INCREASE", "DECREASE", "FLIP"] as const;

export interface RuleEditorProps {
  rule: {
    id?: string;
    scope: "global" | "wallet" | "coin_tier";
    scope_ref: string | null;
    name: string;
    event_types: string[];
    thresholds: Record<string, unknown>;
    routing: Record<string, string | undefined>;
    enabled: boolean;
  };
  /** fully-resolved defaults shown as placeholders (DEFAULT_THRESHOLDS for global; effective parent values for scoped rules) */
  placeholders: Record<string, unknown>;
  channels: Record<string, string>;
  isNew?: boolean;
}

export function RuleEditor({ rule, placeholders, channels, isNew }: RuleEditorProps) {
  const [test, runTest, testing] = useActionState<TestRuleResult | TestRuleError | null, FormData>(testRule, null);
  const t = rule.thresholds;
  const scoped = rule.scope !== "global";
  const ph = (k: string) => {
    const v = getPath(placeholders, k);
    return v === undefined ? "" : String(v);
  };
  const val = (k: string) => {
    const v = getPath(t, k);
    return v === undefined || v === null ? "" : String(v);
  };
  const list = (k: string) => {
    const v = getPath(t, k);
    return Array.isArray(v) ? v.join(", ") : "";
  };
  const etOverride = Array.isArray(t.event_types);
  const etValues = etOverride ? (t.event_types as string[]) : rule.event_types;

  return (
    <form action={saveRule} className="space-y-4">
      {rule.id && <input type="hidden" name="id" value={rule.id} />}
      <input type="hidden" name="scope" value={rule.scope} />
      <div className="grid gap-2 md:grid-cols-4">
        <div>
          <label>Name</label>
          <input type="text" name="name" defaultValue={rule.name} />
        </div>
        {scoped && (
          <div>
            <label>{rule.scope === "wallet" ? "Wallet address" : "Coin tier (major | mid | long_tail)"}</label>
            <input type="text" name="scope_ref" defaultValue={rule.scope_ref ?? ""} required className="font-mono" placeholder={rule.scope === "wallet" ? "0x…" : "major"} />
          </div>
        )}
        <div>
          <label>Enabled</label>
          <select name="enabled" defaultValue={rule.enabled ? "on" : "off"}>
            <option value="on">enabled</option>
            <option value="off">disabled</option>
          </select>
        </div>
        <div>
          <label>Replay window (days)</label>
          <input type="number" name="days" defaultValue={7} min={1} max={30} />
        </div>
      </div>

      <fieldset className="rounded border border-zinc-800 p-3">
        <legend className="px-1 text-xs text-zinc-400">Event types</legend>
        {scoped && (
          <label className="mb-2 flex items-center gap-2 text-sm text-zinc-300">
            <input type="checkbox" name="et.override" defaultChecked={etOverride} /> override event types for this scope
          </label>
        )}
        <div className="flex flex-wrap gap-4">
          {EVENT_TYPES.map((e) => (
            <label key={e} className="flex items-center gap-1 text-sm text-zinc-200">
              <input type="checkbox" name={`et.${e}`} defaultChecked={etValues.includes(e)} /> {e}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="rounded border border-zinc-800 p-3">
        <legend className="px-1 text-xs text-zinc-400">Thresholds {scoped && <span className="text-zinc-500">(blank = inherit)</span>}</legend>
        <div className="grid gap-x-4 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
          {NUMBER_FIELDS.map((f) => (
            <div key={f.key}>
              <label title={f.help}>
                {f.label}
                {f.help && <span className="text-zinc-600"> · {f.help}</span>}
              </label>
              <input type="number" name={`t.${f.key}`} defaultValue={val(f.key)} placeholder={ph(f.key)} step={f.step ?? "any"} />
            </div>
          ))}
          <div>
            <label>Coin whitelist (comma separated; empty = all)</label>
            <input type="text" name="t.coin_whitelist" defaultValue={list("coin_whitelist")} placeholder={ph("coin_whitelist") || "all coins"} />
          </div>
          <div>
            <label>Coin blacklist</label>
            <input type="text" name="t.coin_blacklist" defaultValue={list("coin_blacklist")} placeholder={ph("coin_blacklist") || "none"} />
          </div>
          <label className="flex items-center gap-2 self-end text-sm text-zinc-300">
            <input type="checkbox" name="t.ignore_mm_flag" defaultChecked={t.ignore_mm_flag === true} /> ignore market-maker auto-flag
          </label>
        </div>
      </fieldset>

      <fieldset className="rounded border border-zinc-800 p-3">
        <legend className="px-1 text-xs text-zinc-400">Routing (channel overrides; blank = worker env)</legend>
        <div className="grid gap-2 sm:grid-cols-4">
          {(["high", "feed", "clusters", "ops"] as const).map((k) => (
            <div key={k}>
              <label>{k}</label>
              <input type="text" name={`r.${k}`} defaultValue={rule.routing?.[k] ?? ""} placeholder={channels[k]} />
            </div>
          ))}
        </div>
      </fieldset>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" variant="primary">
          {isNew ? "Create rule" : "Save rule"}
        </Button>
        <Button type="submit" formAction={runTest} disabled={testing}>
          {testing ? "Replaying…" : "Test rule (replay stored events)"}
        </Button>
        {rule.id && scoped && (
          <Button type="submit" variant="danger" formAction={deleteRule} formNoValidate>
            Delete
          </Button>
        )}
      </div>

      {test && !test.ok && <div className="rounded border border-red-800 bg-red-950/40 p-2 text-sm text-red-200">{test.error}</div>}
      {test && test.ok && (
        <div className="rounded border border-sky-800 bg-sky-950/30 p-3 text-sm">
          <div className="mb-1 font-medium">
            Replay of {test.result.total} events over {test.days} days with this (unsaved) rule:
          </div>
          <div className="flex flex-wrap gap-4">
            {Object.entries(test.perChannel).map(([ch, n]) => (
              <span key={ch}>
                <b>{n}</b> → {ch}
              </span>
            ))}
            {Object.keys(test.perChannel).length === 0 && <span>0 alerts would fire</span>}
            <span className="text-zinc-400">{test.result.filtered} filtered</span>
          </div>
          <div className="mt-1 text-xs text-zinc-400">
            {Object.entries(test.result.byReason)
              .sort((a, b) => b[1] - a[1])
              .map(([r, n]) => `${r}: ${n}`)
              .join(" · ")}
          </div>
        </div>
      )}
    </form>
  );
}
