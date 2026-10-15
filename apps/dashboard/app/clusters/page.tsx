import { Badge, Card } from "@/components/ui";
import { getClusters, getWallets, type Row } from "@/lib/data";
import { fmtTs } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function ClustersPage() {
  const [clusters, wallets] = await Promise.all([getClusters(), getWallets()]);
  const byId = new Map(wallets.map((w: Row) => [w.id, w]));
  return (
    <Card title={`Cluster alerts (${clusters.length})`}>
      <table>
        <thead>
          <tr>
            <th>First</th>
            <th>Last</th>
            <th>Coin</th>
            <th>Direction</th>
            <th>Wallets</th>
            <th>Slack</th>
          </tr>
        </thead>
        <tbody>
          {clusters.map((c: Row) => (
            <tr key={c.id}>
              <td className="whitespace-nowrap text-xs">{fmtTs(c.window_start)}</td>
              <td className="whitespace-nowrap text-xs">{fmtTs(c.window_end)}</td>
              <td className="font-medium">{c.coin}</td>
              <td>
                <Badge tone={c.direction === "long" ? "green" : "red"}>{c.direction.toUpperCase()}</Badge>
              </td>
              <td>
                <div className="flex flex-wrap gap-1">
                  {(c.wallet_ids as string[]).map((id) => {
                    const w = byId.get(id);
                    return (
                      <Badge key={id} tone="blue">
                        {w ? `${w.label} (${w.tier})` : id.slice(0, 8)}
                      </Badge>
                    );
                  })}
                </div>
              </td>
              <td className="text-xs text-zinc-400">
                {c.channel ?? "—"} {c.thread_ts ? <span className="font-mono text-zinc-600">{c.thread_ts}</span> : null}
              </td>
            </tr>
          ))}
          {clusters.length === 0 && (
            <tr>
              <td colSpan={6} className="py-8 text-center text-zinc-500">
                No clusters yet. A cluster fires when ≥K tracked wallets OPEN/INCREASE the same coin in the same direction within T minutes (see Rules).
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </Card>
  );
}
