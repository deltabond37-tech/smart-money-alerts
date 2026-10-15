import { ThresholdsSchema, type AlertRule, type CoinTier, type PartialThresholds, type Routing, type Thresholds, type Wallet } from "./types.js";

export const DEFAULT_THRESHOLDS: Thresholds = ThresholdsSchema.parse({});

const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Merge per key; nested groups (dust/mm/score/cluster) merge one level deep so a layer can override a single sub-field. */
export function mergeThresholds(...layers: Array<PartialThresholds | null | undefined>): Thresholds {
  const merged: Record<string, unknown> = {};
  for (const layer of layers) {
    if (!layer) continue;
    for (const [k, v] of Object.entries(layer)) {
      if (v === undefined || v === null) continue;
      const prev = merged[k];
      merged[k] = isPlainObject(v) && isPlainObject(prev) ? { ...prev, ...v } : v;
    }
  }
  return ThresholdsSchema.parse(merged);
}

export interface ResolvedRules {
  thresholds: Thresholds;
  routing: Routing;
}

export interface RuleSet {
  rules: AlertRule[];
  coinTiers: Record<string, CoinTier>;
}

export function findRule(rules: AlertRule[], scope: AlertRule["scope"], scopeRef: string | null): AlertRule | undefined {
  return rules.find((r) => r.enabled && r.scope === scope && (r.scopeRef ?? null) === scopeRef);
}

export function coinTierOf(coin: string, coinTiers: Record<string, CoinTier>): CoinTier {
  return coinTiers[coin] ?? "long_tail";
}

/**
 * Precedence (last wins): defaults < global rule < coin_tier rule < wallet rule < wallets.overrides.
 * `event_types` for the global rule comes from its column; more specific layers only override it
 * when they set `thresholds.event_types` explicitly.
 */
export function resolveRules(ruleSet: RuleSet, wallet: Pick<Wallet, "address" | "overrides">, coin: string): ResolvedRules {
  const global = findRule(ruleSet.rules, "global", null);
  const tierRule = findRule(ruleSet.rules, "coin_tier", coinTierOf(coin, ruleSet.coinTiers));
  const walletRule = findRule(ruleSet.rules, "wallet", wallet.address.toLowerCase());

  const globalLayer: PartialThresholds = {
    ...(global?.thresholds ?? {}),
    ...(global ? { event_types: global.eventTypes } : {}),
  };

  const thresholds = mergeThresholds(globalLayer, tierRule?.thresholds, walletRule?.thresholds, wallet.overrides);
  const routing: Routing = { ...(global?.routing ?? {}), ...(tierRule?.routing ?? {}), ...(walletRule?.routing ?? {}) };
  return { thresholds, routing };
}
