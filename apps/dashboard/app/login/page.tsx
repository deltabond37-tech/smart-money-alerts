import { sendMagicLink } from "./actions";

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  return (
    <main className="min-h-screen flex items-center justify-center p-4">
      <form action={sendMagicLink} className="w-full max-w-sm space-y-4 rounded-lg border border-zinc-800 bg-zinc-900/60 p-6">
        <h1 className="text-lg font-semibold">Smart Money Alerts</h1>
        <p className="text-sm text-zinc-400">Sign in with a magic link.</p>
        <input type="hidden" name="next" value={sp.next ?? "/events"} />
        <div>
          <label htmlFor="email">Email</label>
          <input id="email" name="email" type="email" required placeholder="you@example.com" autoComplete="email" />
        </div>
        {sp.sent && <p className="text-sm text-emerald-400">Check your inbox for the sign-in link.</p>}
        {sp.error && <p className="text-sm text-red-400">{decodeURIComponent(sp.error)}</p>}
        <button type="submit" className="w-full rounded bg-emerald-600 px-3 py-2 text-sm font-medium hover:bg-emerald-500">
          Send magic link
        </button>
      </form>
    </main>
  );
}
