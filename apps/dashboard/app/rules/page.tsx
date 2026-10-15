import { guarded } from "@/components/PageGuard";
import { DEFAULT_THRESHOLDS, mergeThresholds } from "@sma/core";
import { Button, Card, Notice } from "@/components/ui";
import { getCoinTiers, getRules, type Row } from "@/lib/data";
import { slackChannels } from "@/lib/env";
import { RuleEditor } from "./RuleEditor";
import { saveCoinTiers } from "./actions";

export const dynamic = "force-dynamic";

async function RulesPageInner({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const [rules, coinTiers] = await Promise.all([getRules(), getCoinTiers()]);
  const channels = slackChannels();
  const global = rules.find((r: Row) => r.scope === "global");
  const globalEffective = global ? mergeThresholds({ ...global.thresholds, event_types: global.event_types }) : DEFAULT_THRESHOLDS;
  const tierRules = rules.filter((r: Row) => r.scope === "coin_tier");
  const walletRules = rules.filter((r: Row) => r.scope === "wallet");
  const tiersText = Object.entries(coinTiers)
    .map(([c, t]) => `${c},${t}`)
    .join("\n");

  const editorRule = (r: Row) => ({ id: r.id, scope: r.scope, scope_ref: r.scope_ref, name: r.name, event_types: r.event_types ?? [], thresholds: r.thresholds ?? {}, routing: r.routing ?? {}, enabled: !!r.enabled });

  return (
    <div className="space-y-4">
      {sp.ok && <Notice kind="ok">{sp.ok}</Notice>}
      {sp.error && <Notice kind="error">{sp.error}</Notice>}
      <Notice kind="info">
        Precedence: defaults → <b>global</b> → <b>coin tier</b> → <b>wallet rule</b> → wallet overrides JSON. Placeholders show the value that applies when a field is blank. Use “Test rule” to replay stored events before saving.
      </Notice>

      <Card title="Global rule">
        <RuleEditor
          rule={global ? editorRule(global) : { scope: "global", scope_ref: null, name: "Global defaults", event_types: [...DEFAULT_THRESHOLDS.event_types], thresholds: {}, routing: {}, enabled: true }}
          placeholders={DEFAULT_THRESHOLDS as unknown as Record<string, unknown>}
          channels={channels}
          isNew={!global}
        />
      </Card>

      <Card title={`Coin tier rules (${tierRules.length})`}>
        <div className="space-y-6">
          {tierRules.map((r: Row) => (
            <details key={r.id} open={tierRules.length <= 3}>
              <summary className="cursor-pointer text-sm">
                <b>{r.scope_ref}</b> — {r.name} {r.enabled ? "" : "(disabled)"} <span className="text-xs text-zinc-500">{JSON.stringify(r.thresholds)}</span>
              </summary>
              <div className="mt-2">
                <RuleEditor rule={editorRule(r)} placeholders={globalEffective as unknown as Record<string, unknown>} channels={channels} />
              </div>
            </details>
          ))}
          <details>
            <summary className="cursor-pointer text-sm text-emerald-400">+ new coin tier rule</summary>
            <div className="mt-2">
              <RuleEditor rule={{ scope: "coin_tier", scope_ref: "", name: "", event_types: [], thresholds: {}, routing: {}, enabled: true }} placeholders={globalEffective as unknown as Record<string, unknown>} channels={channels} isNew />
            </div>
          </details>
        </div>
      </Card>

      <Card title={`Wallet rules (${walletRules.length})`}>
        <div className="space-y-6">
          {walletRules.map((r: Row) => (
            <details key={r.id}>
              <summary className="cursor-pointer text-sm">
                <span className="font-mono">{r.scope_ref}</span> — {r.name} {r.enabled ? "" : "(disabled)"} <span className="text-xs text-zinc-500">{JSON.stringify(r.thresholds)}</span>
              </summary>
              <div className="mt-2">
                <RuleEditor rule={editorRule(r)} placeholders={globalEffective as unknown as Record<string, unknown>} channels={channels} />
              </div>
            </details>
          ))}
          <details>
            <summary className="cursor-pointer text-sm text-emerald-400">+ new wallet rule</summary>
            <div className="mt-2">
              <RuleEditor rule={{ scope: "wallet", scope_ref: "", name: "", event_types: [], thresholds: {}, routing: {}, enabled: true }} placeholders={globalEffective as unknown as Record<string, unknown>} channels={channels} isNew />
            </div>
          </details>
        </div>
      </Card>

      <Card title="Coin tiers">
        <form action={saveCoinTiers} className="space-y-2">
          <p className="text-xs text-zinc-500">One per line: <code>COIN,major|mid|long_tail</code>. Unlisted coins are treated as long_tail. Replaces the whole list.</p>
          <textarea name="tiers" rows={8} defaultValue={tiersText} className="font-mono text-xs" />
          <Button type="submit" variant="primary">
            Save coin tiers
          </Button>
        </form>
      </Card>
    </div>
  );
}

export default async function RulesPage(props: Parameters<typeof RulesPageInner>[0]) {
  return guarded(() => RulesPageInner(props));
}
