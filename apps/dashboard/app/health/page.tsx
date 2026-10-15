import { guarded } from "@/components/PageGuard";
import { Badge, Button, Card, Notice, Stat } from "@/components/ui";
import { getHealth, type Row } from "@/lib/data";
import { slackChannels } from "@/lib/env";
import { ago, fmtTs } from "@/lib/format";
import { sendTestAlert } from "./actions";

export const dynamic = "force-dynamic";

async function HealthPageInner({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const h = await getHealth();
  const channels = slackChannels();
  const counts = { high: 0, feed: 0, filtered: 0 };
  for (const e of h.events24h) {
    if (e.filtered) counts.filtered++;
    else if (e.channel === channels.high) counts.high++;
    else counts.feed++;
  }
  const sent = h.alerts24h.filter((a: Row) => a.status === "sent").length;
  const failed = h.alerts24h.filter((a: Row) => a.status === "failed").length;

  return (
    <div className="space-y-4">
      {sp.ok && <Notice kind="ok">{sp.ok}</Notice>}
      {sp.error && <Notice kind="error">{sp.error}</Notice>}

      <Card title="Workers">
        {h.heartbeats.length === 0 && <p className="text-sm text-zinc-500">No heartbeats yet. Start the worker (Render) with SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.</p>}
        <div className="grid gap-3 md:grid-cols-2">
          {h.heartbeats.map((hb: Row) => {
            const staleSec = (Date.now() - new Date(hb.updated_at).getTime()) / 1000;
            const lagging = hb.interval_sec && hb.last_loop_at && (Date.now() - new Date(hb.last_loop_at).getTime()) / 1000 > 3 * hb.interval_sec;
            const status = staleSec > 180 ? "down" : lagging ? "lagging" : "ok";
            return (
              <div key={hb.worker_id} className="rounded border border-zinc-800 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="font-mono text-sm">{hb.worker_id}</span>
                  <Badge tone={status === "ok" ? "green" : status === "lagging" ? "amber" : "red"}>{status}</Badge>
                  {hb.dry_run && <Badge tone="amber">DRY RUN</Badge>}
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-zinc-400">
                  <span>heartbeat</span>
                  <span className="text-zinc-200">{ago(hb.updated_at)}</span>
                  <span>last loop</span>
                  <span className="text-zinc-200">
                    {ago(hb.last_loop_at)} ({hb.loop_ms} ms)
                  </span>
                  <span>poll interval</span>
                  <span className="text-zinc-200">{hb.interval_sec}s (auto from wallet count)</span>
                  <span>wallets polled</span>
                  <span className="text-zinc-200">{hb.wallets_polled}</span>
                  <span>HL budget used</span>
                  <span className="text-zinc-200">{hb.budget_used_per_min} weight / min</span>
                  <span>errors (1h)</span>
                  <span className={hb.errors_1h > 0 ? "text-amber-300" : "text-zinc-200"}>{hb.errors_1h}</span>
                  <span>version</span>
                  <span className="text-zinc-200">{hb.version}</span>
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Stat label="High conviction (24h)" value={counts.high} />
        <Stat label="Feed (24h)" value={counts.feed} />
        <Stat label="Filtered (24h)" value={counts.filtered} hint="logged, not posted" />
        <Stat label="Slack sent (24h)" value={sent} />
        <Stat label="Slack failed (24h)" value={failed} />
      </div>

      <Card title="Send test alert">
        <div className="flex flex-wrap gap-2">
          {(Object.keys(channels) as Array<keyof typeof channels>).map((k) => (
            <form key={k} action={sendTestAlert}>
              <input type="hidden" name="channel" value={k} />
              <Button type="submit">
                {k} → {channels[k]}
              </Button>
            </form>
          ))}
        </div>
        <p className="mt-2 text-xs text-zinc-500">Uses the dashboard&apos;s SLACK_BOT_TOKEN (server-side). Bot needs chat:write + chat:write.public, or be invited to private channels.</p>
      </Card>

      <Card title="Failed / stuck Slack posts (24h)">
        {h.failedAlerts.length === 0 ? (
          <p className="text-sm text-zinc-500">None.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th>Channel</th>
                <th>Event</th>
                <th>Status</th>
                <th>Error</th>
              </tr>
            </thead>
            <tbody>
              {h.failedAlerts.map((a: Row) => (
                <tr key={a.id}>
                  <td className="whitespace-nowrap text-xs">{fmtTs(a.created_at)}</td>
                  <td>{a.channel}</td>
                  <td className="text-xs">{a.position_events ? `${a.position_events.event_type} ${a.position_events.coin}` : a.cluster_id ? "cluster" : "—"}</td>
                  <td>
                    <Badge tone={a.status === "failed" ? "red" : "amber"}>{a.status}</Badge>
                  </td>
                  <td className="text-xs text-zinc-400">{a.error}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

export default async function HealthPage(props: Parameters<typeof HealthPageInner>[0]) {
  return guarded(() => HealthPageInner(props));
}
