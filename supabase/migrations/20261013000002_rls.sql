-- RLS: single-org. Any authenticated dashboard user can manage config and read everything.
-- Worker uses the service role (bypasses RLS) and is the only writer of state/event tables.

alter table public.wallets            enable row level security;
alter table public.coin_tiers         enable row level security;
alter table public.alert_rules        enable row level security;
alter table public.wallet_state       enable row level security;
alter table public.position_snapshots enable row level security;
alter table public.fills              enable row level security;
alter table public.position_threads   enable row level security;
alter table public.position_events    enable row level security;
alter table public.cluster_alerts     enable row level security;
alter table public.alerts_sent        enable row level security;
alter table public.worker_heartbeats  enable row level security;

-- config tables: full CRUD for authenticated
create policy wallets_auth_all     on public.wallets     for all to authenticated using (true) with check (true);
create policy coin_tiers_auth_all  on public.coin_tiers  for all to authenticated using (true) with check (true);
create policy alert_rules_auth_all on public.alert_rules for all to authenticated using (true) with check (true);

-- state/event tables: read-only for authenticated (no insert/update/delete policies => denied)
create policy wallet_state_auth_read       on public.wallet_state       for select to authenticated using (true);
create policy position_snapshots_auth_read on public.position_snapshots for select to authenticated using (true);
create policy fills_auth_read              on public.fills              for select to authenticated using (true);
create policy position_threads_auth_read   on public.position_threads   for select to authenticated using (true);
create policy position_events_auth_read    on public.position_events    for select to authenticated using (true);
create policy cluster_alerts_auth_read     on public.cluster_alerts     for select to authenticated using (true);
create policy alerts_sent_auth_read        on public.alerts_sent        for select to authenticated using (true);
create policy worker_heartbeats_auth_read  on public.worker_heartbeats  for select to authenticated using (true);

-- anon gets nothing (no policies). Belt and braces: revoke table privileges from anon.
revoke all on all tables in schema public from anon;
