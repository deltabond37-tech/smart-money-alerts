# supabase/

- `migrations/` — apply in order via Supabase CLI (`supabase db push`) or paste each file into the SQL editor.
- `seed.sql` — sample wallets (placeholders), default global/coin-tier rules, coin tiers.
- Enable **pg_cron** (Database → Extensions) for nightly pruning in-DB; the worker prunes daily regardless.
- Realtime: the schema migration adds `wallets`, `alert_rules`, `coin_tiers` to the `supabase_realtime` publication for hot reload.
- RLS: authenticated users = full CRUD on config tables, read-only on state/event tables. Worker uses the service role.
