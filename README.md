# Smart Money Alerts

Watches a list of smart-money wallets on Hyperliquid, diffs their positions, and posts **only tradable signals** to Slack. The core of the system is classification → aggregation → rule-based filtering → wallet-relative scoring → cluster detection, not raw fill relay.

```
Hyperliquid Info API ──poll/diff──▶ worker (Render) ──▶ Supabase (Postgres) ◀── dashboard (Vercel)
                                        │
                                        └──▶ Slack (#sm-high-conviction, #sm-feed, #sm-clusters, #sm-ops)
```

| Package | What it is |
|---|---|
| `packages/core` | Pure TypeScript: types, classifier, window aggregator, rule engine, filters, scorer, cluster detector, Slack Block Kit formatter, replay engine, rate-limit budgeter. 55 unit tests. |
| `apps/worker` | Long-running Node service (Render Background Worker): Hyperliquid adapter, poll+diff loop, persistence, Slack posting with threading, heartbeat. `--dry-run` mode. 14 end-to-end tests with an in-memory DB. |
| `apps/dashboard` | Next.js 15 App Router on Vercel: wallets, rules (with replay "Test rule"), event log, clusters, health, test alerts. Supabase magic-link auth. |
| `supabase/` | SQL migrations (schema, RLS, functions) and seed. |

## How it decides what to post

1. **Diff.** Every cycle the worker fetches `allMids` once and `clearinghouseState` per wallet (weight 2 each), compares to the last *committed* snapshot, and opens a per-wallet+coin **aggregation window** (default 120 s) on the first change. Fills are fetched only when a window closes (weight 20+), so cost scales with wallets, not activity.
2. **Classify** the *net* change s0 → s1 over the window: `OPEN`, `CLOSE`, `INCREASE`, `DECREASE`, `FLIP`, with Δsize, Δnotional, % change, new notional, % of equity, leverage, entry/mark/liq px, uPnL, realized PnL (from fills), fill count and taker ratio. A TWAP of 10 fills in 2 minutes is one event.
3. **Filter** (rule engine, precedence `defaults → global → coin tier → wallet rule → wallet overrides`): event types on/off, min Δnotional, min % change, min % of equity, leverage range, coin allow/deny lists, CLOSE min realized PnL, cooldown per wallet+coin (FLIP/CLOSE exempt), dust (small in both % and USD), muted, and the market-maker auto-flag. Filtered events are **stored with a reason**, never posted.
4. **Score 0–100** with stored components: size z-score vs the wallet's own trailing-30-day events (0–35; falls back to an absolute scale when history is thin), % of equity (0–25), wallet tier (A 15 / B 8 / C 0), event type (FLIP 15, OPEN 12, INCREASE 8, DECREASE/CLOSE 4), confluence (+10).
5. **Route**: score ≥ `score.high` → `#sm-high-conviction`; ≥ `score.low` → `#sm-feed`; below → DB only.
6. **Thread**: OPEN/FLIP start a lifecycle thread; INCREASE/DECREASE/CLOSE reply in it (also broadcast to channel if score ≥ `thread_broadcast_min_score`); CLOSE closes it.
7. **Cluster**: ≥ K tracked wallets OPEN/INCREASE the same coin, same direction, within T minutes → one alert in `#sm-clusters`; later joiners reply in that thread.
8. **Idempotency**: `event_key = sha256(wallet|coin|window_end|s0|s1)` with a UNIQUE constraint; event + snapshot commit atomically (`commit_position_event`). Restarts re-derive pending changes from the committed snapshot, so nothing is lost and nothing double-posts.

## Setup

### 1. Supabase
1. Create a project. In **SQL Editor** run, in order: `supabase/migrations/20261013000001_schema.sql`, `…0002_rls.sql`, `…0003_functions.sql`, then `supabase/seed.sql` (or `supabase db push` with the CLI).
2. Replace the three placeholder wallets in `wallets` with real addresses (or use the dashboard).
3. **Auth → URL Configuration**: set Site URL to your dashboard URL and add `https://<dashboard>/auth/confirm` (and `http://localhost:3000/auth/confirm` for dev) to Redirect URLs. Recommended: Auth → Providers → Email → disable "Allow new users to sign up" and invite users manually, and/or set `DASHBOARD_ALLOWED_EMAILS`.
4. Optional: enable the `pg_cron` extension for in-database nightly pruning (the worker prunes daily anyway).
5. Copy the **Project URL**, **anon/publishable key** (dashboard) and **service_role key** (worker only, never in the browser).

### 2. Slack app
1. https://api.slack.com/apps → Create New App → From scratch.
2. **OAuth & Permissions → Bot Token Scopes**: `chat:write`, `chat:write.public`. Install to workspace; copy the **Bot User OAuth Token** (`xoxb-…`).
3. Create channels `#sm-high-conviction`, `#sm-feed`, `#sm-clusters`, `#sm-ops` (public; with `chat:write.public` the bot can post without being invited. For private channels, invite the bot and use the channel ID).

### 3. Local run
```bash
pnpm install
pnpm -r test                      # 69 tests
cp apps/worker/.env.example apps/worker/.env       # fill Supabase + Slack
cp apps/dashboard/.env.example apps/dashboard/.env # fill Supabase anon + Slack
pnpm --filter @sma/worker dry-run  # logs alerts instead of posting; still writes events/snapshots
pnpm dashboard:dev                 # http://localhost:3000
pnpm --filter @sma/worker smoke 0x<address>   # read-only check of the HL adapter for one wallet
```
On first sight of a wallet the worker **baselines** its existing positions (no alerts); only subsequent changes produce events.

### 4. Deploy the worker (Render)
1. Push the repo to GitHub. Render → **New → Blueprint** → pick the repo; `render.yaml` defines `sma-worker` (Background Worker, Docker, `apps/worker/Dockerfile`).
2. Enter the `sync: false` secrets when prompted: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SLACK_BOT_TOKEN`.
3. Deploy. The worker posts "Worker started" to `#sm-ops` and writes a heartbeat every minute (visible on the dashboard Health page).

### 5. Deploy the dashboard (Vercel)
1. Vercel → **Add New Project** → import the repo. Set **Root Directory** to `apps/dashboard` (`apps/dashboard/vercel.json` holds the monorepo install/build commands). Framework: Next.js.
2. Environment variables: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SLACK_BOT_TOKEN`, `SLACK_CHANNEL_*`, `TZ=Asia/Kolkata`, optional `DASHBOARD_ALLOWED_EMAILS`.
3. Deploy, then add the Vercel URL to Supabase Auth redirect URLs (step 1.3).

## Environment variables

| Variable | Where | Notes |
|---|---|---|
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | worker | service role bypasses RLS; worker is the only writer of state/event tables |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | dashboard | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` also accepted |
| `SLACK_BOT_TOKEN` | both | dashboard uses it only for "Send test alert" |
| `SLACK_CHANNEL_HIGH/FEED/CLUSTERS/OPS` | both | defaults `#sm-high-conviction`, `#sm-feed`, `#sm-clusters`, `#sm-ops`; rules can override per scope |
| `HL_API_URL`, `HL_WS_URL` | worker | public Info API |
| `POLL_BUDGET_WEIGHT_PER_MIN` | worker | default 800 of the 1200/min IP limit; the poll interval is derived from wallet count: `interval = max(POLL_MIN_INTERVAL_SEC, ceil((2N+2) / ((budget−200)/60)))` → 50 wallets ≈ 11 s, 200 ≈ 41 s |
| `ENABLE_PRIORITY_WS` | worker | WebSocket `userFills` trigger for up to 10 `is_priority` wallets (HL cap per IP); polls them immediately on activity |
| `AGG_WINDOW_SEC` | worker | fallback only; the global rule's `agg_window_sec` wins |
| `CONFIG_RELOAD_SEC`, `FILLS_SYNC_INTERVAL_SEC`, `RETENTION_DAYS`, `DRY_RUN`, `LOG_LEVEL`, `WORKER_ID`, `TZ` | worker | see `apps/worker/.env.example` |
| `DASHBOARD_ALLOWED_EMAILS` | dashboard | optional comma-separated allowlist |

## Tuning the noise

All thresholds live in `alert_rules.thresholds` (JSON) and are edited on the **Rules** page. Defaults (`packages/core/src/types.ts`):

| Key | Default | Effect |
|---|---|---|
| `min_delta_notional_usd` | 25 000 | absolute floor on Δnotional (coin-tier rules in the seed set 50k majors / 25k mid / 10k long tail) |
| `min_pct_change` | 25 | INCREASE/DECREASE must move ≥ 25 % of the prior size |
| `min_equity_pct` | 2 | position (max of prior/new) must be ≥ 2 % of account value |
| `min_leverage` / `max_leverage` | 0 / 100 | |
| `close_min_realized_pnl_usd` | 5 000 | small-PnL closes are logged only |
| `cooldown_sec` | 1800 | per wallet+coin; FLIP/CLOSE exempt |
| `dust.pct` / `dust.usd` | 5 / 2 000 | ignore when below **both** |
| `mm.fills_per_day` / `mm.drift_ratio` | 200 / 0.1 | auto-flag market makers (fills/day above AND notional-weighted drift below; 10× fills/day flags regardless) → muted unless `ignore_mm_flag` |
| `score.high` / `score.low` | 70 / 40 | routing thresholds |
| `cluster.k` / `cluster.t_min` | 3 / 60 | cluster rule |
| `agg_window_sec` | 120 | coalescing window (global only) |
| `thread_broadcast_min_score` | 85 | thread replies at/above this also go to the channel |
| `zscore_min_samples` | 5 | below this many trailing events the size score uses an absolute scale |

Workflow: edit a rule → **Test rule** replays the last 7 days of stored events (including filtered ones) and shows how many alerts would have fired per channel and why the rest were filtered → adjust → **Save**. The worker reloads config within 60 s (Realtime + timer), no redeploy.

Per-wallet tweaks: the **Wallets** page `overrides` JSON accepts any threshold key and wins over every rule, e.g. `{"min_delta_notional_usd": 100000, "ignore_mm_flag": true}`.

## Operations
- **Health page**: heartbeat age, loop lag, poll interval, budget use, error count, failed Slack posts, per-channel 24h counts.
- **`#sm-ops`** gets: worker start, poll loop lagging > 3× interval, ≥ 3 consecutive Slack failures, alerts that were mid-post during a restart (marked failed, not re-sent).
- **Restart safety**: committed snapshots + unique event keys → no duplicate alerts; a CLOSE after restart still threads under the original OPEN via `position_threads`.
- **Retention**: `prune_old_data(30)` deletes fills, flat snapshots and heartbeats older than 30 days; events, threads and clusters are kept.
- **Logs**: pino JSON (`LOG_PRETTY=true` locally).

## Known limitations
- A round trip that opens and fully closes inside one aggregation window nets to zero and produces no event (fills still count toward market-maker stats).
- Single worker instance; running two against the same DB would double-poll (the unique event key still prevents duplicate alerts).
- Perps only (`clearinghouseState`); spot balances are ignored.
- The Dockerfile has not been built locally in this environment (Docker unavailable); Render builds it.

## Out of scope
No trade execution, no order placement, no private keys anywhere.
