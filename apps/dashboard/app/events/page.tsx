import { guarded } from "@/components/PageGuard";
import { Badge, Button, Card, EVENT_TONE } from "@/components/ui";
import { getEvents, getWallets, type Row } from "@/lib/data";
import { fmtNum, fmtPct, fmtTs, fmtUsd } from "@/lib/format";

export const dynamic = "force-dynamic";

const REASONS = ["muted", "mm_flagged", "event_type_disabled", "coin_blacklist", "coin_not_whitelisted", "dust", "min_delta_notional", "min_pct_change", "min_equity_pct", "leverage_out_of_range", "close_min_realized_pnl", "cooldown", "below_score_threshold"];

async function EventsPageInner({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const filters = {
    wallet: sp.wallet || undefined,
    coin: sp.coin || undefined,
    type: sp.type || undefined,
    status: (sp.status === "alerted" || sp.status === "filtered" ? sp.status : "") as "alerted" | "filtered" | "",
    reason: sp.reason || undefined,
    minScore: sp.minScore ? Number(sp.minScore) : undefined,
    days: sp.days ? Number(sp.days) : 7,
  };
  const [events, wallets] = await Promise.all([getEvents(filters), getWallets()]);
  const alerted = events.filter((e: Row) => !e.filtered).length;

  return (
    <div className="space-y-4">
      <Card title="Event log">
        <form method="get" className="grid gap-2 sm:grid-cols-3 lg:grid-cols-7">
          <select name="wallet" defaultValue={sp.wallet ?? ""}>
            <option value="">all wallets</option>
            {wallets.map((w: Row) => (
              <option key={w.id} value={w.id}>
                {w.label}
              </option>
            ))}
          </select>
          <input type="text" name="coin" placeholder="coin" defaultValue={sp.coin ?? ""} />
          <select name="type" defaultValue={sp.type ?? ""}>
            <option value="">all types</option>
            {["OPEN", "CLOSE", "INCREASE", "DECREASE", "FLIP"].map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
          <select name="status" defaultValue={sp.status ?? ""}>
            <option value="">alerted + filtered</option>
            <option value="alerted">alerted only</option>
            <option value="filtered">filtered only</option>
          </select>
          <select name="reason" defaultValue={sp.reason ?? ""}>
            <option value="">any reason</option>
            {REASONS.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
          <input type="number" name="minScore" placeholder="min score" defaultValue={sp.minScore ?? ""} />
          <div className="flex gap-1">
            <select name="days" defaultValue={String(filters.days)}>
              {[1, 3, 7, 14, 30].map((d) => (
                <option key={d} value={d}>
                  {d}d
                </option>
              ))}
            </select>
            <Button type="submit">Filter</Button>
          </div>
        </form>
        <p className="mt-2 text-xs text-zinc-500">
          {events.length} events (max 200) · {alerted} alerted · {events.length - alerted} filtered
        </p>
      </Card>

      <Card>
        <div className="overflow-x-auto">
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th>Wallet</th>
                <th>Coin</th>
                <th>Type</th>
                <th>Δ size / Δ notional</th>
                <th>New pos</th>
                <th>% chg</th>
                <th>% eq</th>
                <th>Lev</th>
                <th>PnL</th>
                <th>Score</th>
                <th>Outcome</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e: Row) => {
                const c = e.score_components ?? {};
                const title = `size ${c.size_z ?? "?"}${c.z !== null && c.z !== undefined ? ` (z ${c.z})` : " (abs)"} · equity ${c.equity_pct ?? "?"} · tier ${c.tier ?? "?"} · type ${c.event_type ?? "?"} · confluence ${c.confluence ?? "?"} · n=${c.wallet_n ?? "?"} mean=${c.wallet_mean ? fmtUsd(c.wallet_mean) : "?"}`;
                return (
                  <tr key={e.id} className={e.filtered ? "text-zinc-400" : ""}>
                    <td className="whitespace-nowrap text-xs">{fmtTs(e.window_end)}</td>
                    <td>
                      <span className="text-zinc-200">{e.wallets?.label ?? e.wallet_id.slice(0, 8)}</span> <Badge>{e.wallets?.tier ?? "?"}</Badge>
                    </td>
                    <td className="font-medium">{e.coin}</td>
                    <td>
                      <Badge tone={EVENT_TONE[e.event_type] ?? "zinc"}>{e.event_type}</Badge> <span className="text-[11px] text-zinc-500">{e.side}</span>
                    </td>
                    <td className="whitespace-nowrap">
                      {Number(e.delta_size) > 0 ? "+" : ""}
                      {fmtNum(e.delta_size, 4)} / {fmtUsd(e.delta_notional_usd)}
                    </td>
                    <td className="whitespace-nowrap">{fmtUsd(e.new_notional_usd)}</td>
                    <td>{e.pct_change === null ? "new" : fmtPct(e.pct_change)}</td>
                    <td>{fmtPct(e.equity_pct)}</td>
                    <td>{e.leverage ? `${fmtNum(e.leverage, 1)}x` : "—"}</td>
                    <td className="whitespace-nowrap">{e.realized_pnl !== null ? `R ${fmtUsd(e.realized_pnl)}` : e.unrealized_pnl !== null ? `U ${fmtUsd(e.unrealized_pnl)}` : "—"}</td>
                    <td>
                      <span title={title} className="cursor-help font-semibold text-zinc-100">
                        {e.score}
                      </span>
                    </td>
                    <td>
                      {e.filtered ? (
                        <Badge tone="red">{e.filter_reason}</Badge>
                      ) : (
                        <Badge tone="green">→ {e.channel ?? "alerted"}</Badge>
                      )}
                    </td>
                  </tr>
                );
              })}
              {events.length === 0 && (
                <tr>
                  <td colSpan={12} className="py-8 text-center text-zinc-500">
                    No events match. The worker writes every classified event here, including filtered ones.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

export default async function EventsPage(props: Parameters<typeof EventsPageInner>[0]) {
  return guarded(() => EventsPageInner(props));
}
