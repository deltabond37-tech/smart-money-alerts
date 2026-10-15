import { EVENT_TYPES, ThresholdsSchema, type EventType, type PartialThresholds, type Routing } from "@sma/core";
import { NUMBER_FIELDS } from "./ruleFields";

const set = (o: Record<string, unknown>, path: string, v: unknown) => {
  const parts = path.split(".");
  let cur = o;
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i]!;
    if (typeof cur[k] !== "object" || cur[k] === null) cur[k] = {};
    cur = cur[k] as Record<string, unknown>;
  }
  cur[parts[parts.length - 1]!] = v;
};

export interface ParsedRule {
  eventTypes: EventType[];
  thresholds: PartialThresholds;
  routing: Routing;
  name: string;
  enabled: boolean;
  scope: "global" | "wallet" | "coin_tier";
  scopeRef: string | null;
}

/** Parse the rule editor form. Blank numeric inputs are omitted so they inherit. */
export function parseRuleForm(fd: FormData): ParsedRule {
  const t: Record<string, unknown> = {};
  for (const f of NUMBER_FIELDS) {
    const raw = String(fd.get(`t.${f.key}`) ?? "").trim();
    if (raw === "") continue;
    const n = Number(raw);
    if (!Number.isFinite(n)) throw new Error(`${f.label}: not a number`);
    set(t, f.key, n);
  }
  for (const list of ["coin_whitelist", "coin_blacklist"] as const) {
    const raw = String(fd.get(`t.${list}`) ?? "").trim();
    if (fd.get(`t.${list}.set`) === "on" || raw !== "") {
      t[list] = raw
        .split(/[,\s]+/)
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean);
    }
  }
  if (fd.get("t.ignore_mm_flag") === "on") t.ignore_mm_flag = true;

  const scope = String(fd.get("scope") ?? "global") as ParsedRule["scope"];
  const eventTypes = EVENT_TYPES.filter((e) => fd.get(`et.${e}`) === "on");
  if (scope !== "global" && fd.get("et.override") === "on") t.event_types = eventTypes;

  // validate the partial by merging over defaults
  ThresholdsSchema.parse({ ...t });

  const routing: Routing = {};
  for (const k of ["high", "feed", "clusters", "ops"] as const) {
    const v = String(fd.get(`r.${k}`) ?? "").trim();
    if (v) routing[k] = v;
  }
  return {
    scope,
    scopeRef: scope === "global" ? null : String(fd.get("scope_ref") ?? "").trim().toLowerCase() || null,
    name: String(fd.get("name") ?? "").trim() || "Rule",
    enabled: fd.get("enabled") !== "off",
    eventTypes: scope === "global" ? eventTypes : [...EVENT_TYPES],
    thresholds: t as PartialThresholds,
    routing,
  };
}
