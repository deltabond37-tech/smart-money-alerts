import { guarded } from "@/components/PageGuard";
import { Badge, Button, Card, Notice } from "@/components/ui";
import { getWallets, type Row } from "@/lib/data";
import { ago, short } from "@/lib/format";
import { createWallet, deleteWallet, importCsv, toggleWallet, updateWallet } from "./actions";

export const dynamic = "force-dynamic";

function Toggle({ id, field, value, labels }: { id: string; field: string; value: boolean; labels: [string, string] }) {
  return (
    <form action={toggleWallet}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="field" value={field} />
      <input type="hidden" name="value" value={String(!value)} />
      <Button variant={value ? "primary" : "ghost"} type="submit" title={`Click to set ${field} = ${!value}`}>
        {value ? labels[0] : labels[1]}
      </Button>
    </form>
  );
}

function WalletRow({ w }: { w: Row }) {
  const st = Array.isArray(w.wallet_state) ? w.wallet_state[0] : w.wallet_state;
  const mm = st?.auto_flags?.mm === true;
  return (
    <tr>
      <td>
        <div className="font-medium">{w.label}</div>
        <div className="font-mono text-[11px] text-zinc-500" title={w.address}>
          {short(w.address)}
          {" · "}
          <a className="hover:text-zinc-300" href={`https://hypurrscan.io/address/${w.address}`} target="_blank" rel="noreferrer">
            hypurrscan
          </a>
        </div>
      </td>
      <td>
        <Badge tone={w.tier === "A" ? "green" : w.tier === "B" ? "blue" : "zinc"}>{w.tier}</Badge>
      </td>
      <td>
        <div className="flex gap-1">
          <Toggle id={w.id} field="is_active" value={!!w.is_active} labels={["active", "inactive"]} />
          <Toggle id={w.id} field="is_priority" value={!!w.is_priority} labels={["priority", "normal"]} />
          <Toggle id={w.id} field="muted" value={!!w.muted} labels={["muted", "unmuted"]} />
        </div>
      </td>
      <td>
        {mm ? (
          <Badge tone="amber" >MM flagged</Badge>
        ) : st?.auto_flags?.fills_per_day !== undefined ? (
          <span className="text-xs text-zinc-500">{st.auto_flags.fills_per_day} fills/d · drift {st.auto_flags.drift_ratio}</span>
        ) : (
          <span className="text-xs text-zinc-600">no data</span>
        )}
        {st?.consecutive_errors > 0 && (
          <div className="text-[11px] text-red-400" title={st.last_error}>
            {st.consecutive_errors} consecutive errors
          </div>
        )}
      </td>
      <td className="text-xs text-zinc-400">
        {ago(st?.last_poll_at)}
        {st?.account_value ? <div className="text-zinc-500">equity ${Number(st.account_value).toLocaleString("en-US", { maximumFractionDigits: 0 })}</div> : null}
      </td>
      <td>
        <details>
          <summary className="cursor-pointer text-xs text-zinc-400 hover:text-zinc-200">edit</summary>
          <form action={updateWallet} className="mt-2 grid grid-cols-2 gap-2 rounded border border-zinc-800 bg-zinc-950 p-2">
            <input type="hidden" name="id" value={w.id} />
            <div>
              <label>Label</label>
              <input type="text" name="label" defaultValue={w.label} required />
            </div>
            <div>
              <label>Tier</label>
              <select name="tier" defaultValue={w.tier}>
                <option>A</option>
                <option>B</option>
                <option>C</option>
              </select>
            </div>
            <div className="col-span-2">
              <label>Notes</label>
              <input type="text" name="notes" defaultValue={w.notes ?? ""} />
            </div>
            <div className="col-span-2">
              <label>Overrides (partial thresholds JSON, wins over all rules)</label>
              <textarea name="overrides" rows={3} defaultValue={JSON.stringify(w.overrides ?? {})} className="font-mono text-xs" />
            </div>
            <div className="col-span-2 flex justify-between">
              <Button type="submit" variant="primary">
                Save
              </Button>
              <Button type="submit" variant="danger" formAction={deleteWallet} formNoValidate>
                Delete
              </Button>
            </div>
          </form>
        </details>
      </td>
    </tr>
  );
}

async function WalletsPageInner({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const wallets = await getWallets();
  return (
    <div className="space-y-4">
      {sp.ok && <Notice kind="ok">{sp.ok}</Notice>}
      {sp.error && <Notice kind="error">{sp.error}</Notice>}

      <Card title={`Wallets (${wallets.length})`}>
        <table>
          <thead>
            <tr>
              <th>Wallet</th>
              <th>Tier</th>
              <th>Flags</th>
              <th>Auto-detect</th>
              <th>Last poll</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {wallets.map((w) => (
              <WalletRow key={w.id} w={w} />
            ))}
          </tbody>
        </table>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Add wallet">
          <form action={createWallet} className="grid grid-cols-2 gap-2">
            <div className="col-span-2">
              <label>Address</label>
              <input type="text" name="address" placeholder="0x…" required pattern="^0x[0-9a-fA-F]{40}$" className="font-mono" />
            </div>
            <div>
              <label>Label</label>
              <input type="text" name="label" required />
            </div>
            <div>
              <label>Tier</label>
              <select name="tier" defaultValue="C">
                <option>A</option>
                <option>B</option>
                <option>C</option>
              </select>
            </div>
            <div className="col-span-2">
              <label>Notes</label>
              <input type="text" name="notes" />
            </div>
            <label className="col-span-2 flex items-center gap-2 text-sm text-zinc-300">
              <input type="checkbox" name="is_priority" /> priority (WebSocket trigger, max 10)
            </label>
            <div className="col-span-2">
              <Button type="submit" variant="primary">
                Add
              </Button>
            </div>
          </form>
        </Card>

        <Card title="Bulk CSV import">
          <form action={importCsv} className="space-y-2">
            <p className="text-xs text-zinc-500">
              Columns: <code>address,label,tier,priority,notes</code>. Header optional. Existing addresses are updated.
            </p>
            <textarea name="csv" rows={6} placeholder={"0xabc…,Whale 1,A,yes\n0xdef…,Fund 2,B"} className="font-mono text-xs" />
            <input type="file" name="file" accept=".csv,text/csv" className="text-xs text-zinc-400" />
            <Button type="submit" variant="primary">
              Import
            </Button>
          </form>
        </Card>
      </div>
    </div>
  );
}

export default async function WalletsPage(props: Parameters<typeof WalletsPageInner>[0]) {
  return guarded(() => WalletsPageInner(props));
}
