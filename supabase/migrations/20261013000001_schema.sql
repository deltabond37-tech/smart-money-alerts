-- Smart Money Alerts — core schema
-- Conventions: lowercase identifiers, numeric for sizes/prices, bigint ms epoch for HL timestamps.

create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------- config (dashboard-editable)

create table public.wallets (
  id          uuid primary key default gen_random_uuid(),
  address     text not null unique check (address = lower(address) and address ~ '^0x[0-9a-f]{40}$'),
  label       text not null,
  tier        text not null default 'C' check (tier in ('A','B','C')),
  venue       text not null default 'hyperliquid',
  is_active   boolean not null default true,
  is_priority boolean not null default false,
  muted       boolean not null default false,
  notes       text,
  overrides   jsonb not null default '{}'::jsonb,   -- partial Thresholds; wins over alert_rules
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger wallets_updated_at before update on public.wallets
  for each row execute function public.set_updated_at();
create index wallets_active_idx on public.wallets (is_active) where is_active;

create table public.coin_tiers (
  coin       text primary key,
  tier       text not null check (tier in ('major','mid','long_tail')),
  updated_at timestamptz not null default now()
);
create trigger coin_tiers_updated_at before update on public.coin_tiers
  for each row execute function public.set_updated_at();

create table public.alert_rules (
  id          uuid primary key default gen_random_uuid(),
  scope       text not null check (scope in ('global','wallet','coin_tier')),
  scope_ref   text,                                  -- wallet address | coin tier; null for global
  name        text not null,
  event_types text[] not null default array['OPEN','CLOSE','INCREASE','DECREASE','FLIP'],
  thresholds  jsonb not null default '{}'::jsonb,   -- partial Thresholds (see @sma/core)
  routing     jsonb not null default '{}'::jsonb,   -- {high, feed, clusters, ops} channel overrides
  enabled     boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint alert_rules_scope_ref_chk check ((scope = 'global') = (scope_ref is null))
);
create unique index alert_rules_scope_uidx on public.alert_rules (scope, coalesce(scope_ref, ''));
create trigger alert_rules_updated_at before update on public.alert_rules
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------- worker state (service role writes)

create table public.wallet_state (
  wallet_id           uuid primary key references public.wallets (id) on delete cascade,
  last_fill_time      bigint not null default 0,       -- ms epoch of newest fill ingested
  last_fills_sync_at  timestamptz,
  last_poll_at        timestamptz,
  account_value       numeric,
  consecutive_errors  integer not null default 0,
  last_error          text,
  auto_flags          jsonb not null default '{}'::jsonb, -- {mm:boolean, fills_per_day, drift_ratio, at}
  updated_at          timestamptz not null default now()
);
create trigger wallet_state_updated_at before update on public.wallet_state
  for each row execute function public.set_updated_at();

create table public.position_snapshots (
  wallet_id       uuid not null references public.wallets (id) on delete cascade,
  coin            text not null,
  szi             numeric not null,                 -- signed size; 0 = flat (row kept until pruned)
  entry_px        numeric,
  position_value  numeric,
  leverage        numeric,
  liq_px          numeric,
  unrealized_pnl  numeric,
  mark_px         numeric,
  account_value   numeric,
  committed_at    timestamptz not null default now(),
  primary key (wallet_id, coin)
);
create index position_snapshots_committed_idx on public.position_snapshots (committed_at);

create table public.fills (
  wallet_id      uuid not null references public.wallets (id) on delete cascade,
  tid            bigint not null,
  hash           text,
  coin           text not null,
  px             numeric not null,
  sz             numeric not null,
  side           text not null,                     -- 'B' | 'A'
  dir            text,                              -- e.g. 'Open Long', 'Close Short'
  start_position numeric,
  closed_pnl     numeric,
  fee            numeric,
  time           bigint not null,                   -- ms epoch
  crossed        boolean,                           -- true = taker
  primary key (wallet_id, tid)
);
create index fills_wallet_time_idx on public.fills (wallet_id, time desc);
create index fills_time_idx on public.fills (time);

create table public.position_threads (
  lifecycle_id uuid primary key default gen_random_uuid(),
  wallet_id    uuid not null references public.wallets (id) on delete cascade,
  coin         text not null,
  channel      text not null,
  thread_ts    text not null,
  opened_at    timestamptz not null default now(),
  closed_at    timestamptz
);
create unique index position_threads_open_uidx on public.position_threads (wallet_id, coin) where closed_at is null;

create table public.position_events (
  id                 uuid primary key default gen_random_uuid(),
  event_key          text not null unique,          -- sha256(wallet|coin|window_end|s0|s1)
  wallet_id          uuid not null references public.wallets (id) on delete cascade,
  coin               text not null,
  event_type         text not null check (event_type in ('OPEN','CLOSE','INCREASE','DECREASE','FLIP')),
  side               text not null check (side in ('long','short')),
  window_start       timestamptz not null,
  window_end         timestamptz not null,
  s0                 numeric not null,
  s1                 numeric not null,
  delta_size         numeric not null,
  delta_notional_usd numeric not null,
  pct_change         numeric,                       -- null for OPEN
  new_notional_usd   numeric not null,
  equity_pct         numeric,
  leverage           numeric,
  entry_px           numeric,
  avg_fill_px        numeric,
  mark_px            numeric,
  liq_px             numeric,
  unrealized_pnl     numeric,
  realized_pnl       numeric,
  fill_count         integer not null default 0,
  taker_ratio        numeric,
  score              integer not null default 0,
  score_components   jsonb not null default '{}'::jsonb,
  filtered           boolean not null default false,
  filter_reason      text,
  channel            text,                          -- resolved channel if alerted
  lifecycle_id       uuid references public.position_threads (lifecycle_id) on delete set null,
  created_at         timestamptz not null default now()
);
create index position_events_wallet_idx    on public.position_events (wallet_id, created_at desc);
create index position_events_coin_idx      on public.position_events (coin, created_at desc);
create index position_events_created_idx   on public.position_events (created_at desc);
create index position_events_lifecycle_idx on public.position_events (lifecycle_id);

create table public.cluster_alerts (
  id           uuid primary key default gen_random_uuid(),
  coin         text not null,
  direction    text not null check (direction in ('long','short')),
  window_start timestamptz not null,
  window_end   timestamptz not null,
  wallet_ids   uuid[] not null,
  event_ids    uuid[] not null,
  channel      text,
  thread_ts    text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (coin, direction, window_start)
);
create trigger cluster_alerts_updated_at before update on public.cluster_alerts
  for each row execute function public.set_updated_at();
create index cluster_alerts_created_idx on public.cluster_alerts (created_at desc);

create table public.alerts_sent (
  id         uuid primary key default gen_random_uuid(),
  event_id   uuid references public.position_events (id) on delete cascade,
  cluster_id uuid references public.cluster_alerts (id) on delete cascade,
  channel    text not null,
  ts         text,                                  -- slack message ts
  thread_ts  text,
  status     text not null default 'pending' check (status in ('pending','posting','sent','failed')),
  error      text,
  attempts   integer not null default 0,
  created_at timestamptz not null default now(),
  sent_at    timestamptz,
  constraint alerts_sent_target_chk check (num_nonnulls(event_id, cluster_id) = 1)
);
create index alerts_sent_event_idx   on public.alerts_sent (event_id);
create index alerts_sent_cluster_idx on public.alerts_sent (cluster_id);
create index alerts_sent_status_idx  on public.alerts_sent (status) where status in ('pending','posting','failed');

create table public.worker_heartbeats (
  worker_id            text primary key,
  last_loop_at         timestamptz not null default now(),
  loop_ms              integer,
  interval_sec         integer,
  wallets_polled       integer,
  budget_used_per_min  integer,
  errors_1h            integer not null default 0,
  version              text,
  dry_run              boolean not null default false,
  updated_at           timestamptz not null default now()
);

-- Realtime for hot config reload (worker subscribes to postgres_changes on these tables)
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.wallets, public.alert_rules, public.coin_tiers;
  end if;
end $$;
