-- Atomic commit: insert classified event + upsert committed snapshot in one transaction.
-- Returns the new event id, or null if the event_key already exists (idempotent on restart).
create or replace function public.commit_position_event(p_event jsonb, p_snapshot jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  insert into public.position_events (
    event_key, wallet_id, coin, event_type, side, window_start, window_end,
    s0, s1, delta_size, delta_notional_usd, pct_change, new_notional_usd, equity_pct,
    leverage, entry_px, avg_fill_px, mark_px, liq_px, unrealized_pnl, realized_pnl,
    fill_count, taker_ratio, score, score_components, filtered, filter_reason, channel, lifecycle_id
  )
  select
    e.event_key, e.wallet_id, e.coin, e.event_type, e.side, e.window_start, e.window_end,
    e.s0, e.s1, e.delta_size, e.delta_notional_usd, e.pct_change, e.new_notional_usd, e.equity_pct,
    e.leverage, e.entry_px, e.avg_fill_px, e.mark_px, e.liq_px, e.unrealized_pnl, e.realized_pnl,
    coalesce(e.fill_count, 0), e.taker_ratio, coalesce(e.score, 0), coalesce(e.score_components, '{}'::jsonb),
    coalesce(e.filtered, false), e.filter_reason, e.channel, e.lifecycle_id
  from jsonb_to_record(p_event) as e(
    event_key text, wallet_id uuid, coin text, event_type text, side text,
    window_start timestamptz, window_end timestamptz,
    s0 numeric, s1 numeric, delta_size numeric, delta_notional_usd numeric, pct_change numeric,
    new_notional_usd numeric, equity_pct numeric, leverage numeric, entry_px numeric, avg_fill_px numeric,
    mark_px numeric, liq_px numeric, unrealized_pnl numeric, realized_pnl numeric,
    fill_count integer, taker_ratio numeric, score integer, score_components jsonb,
    filtered boolean, filter_reason text, channel text, lifecycle_id uuid
  )
  on conflict (event_key) do nothing
  returning id into v_id;

  if v_id is null then
    return null; -- duplicate: leave snapshot untouched
  end if;

  insert into public.position_snapshots (
    wallet_id, coin, szi, entry_px, position_value, leverage, liq_px, unrealized_pnl, mark_px, account_value, committed_at
  )
  select s.wallet_id, s.coin, s.szi, s.entry_px, s.position_value, s.leverage, s.liq_px, s.unrealized_pnl,
         s.mark_px, s.account_value, now()
  from jsonb_to_record(p_snapshot) as s(
    wallet_id uuid, coin text, szi numeric, entry_px numeric, position_value numeric, leverage numeric,
    liq_px numeric, unrealized_pnl numeric, mark_px numeric, account_value numeric
  )
  on conflict (wallet_id, coin) do update set
    szi = excluded.szi, entry_px = excluded.entry_px, position_value = excluded.position_value,
    leverage = excluded.leverage, liq_px = excluded.liq_px, unrealized_pnl = excluded.unrealized_pnl,
    mark_px = excluded.mark_px, account_value = excluded.account_value, committed_at = now();

  return v_id;
end;
$$;
revoke execute on function public.commit_position_event(jsonb, jsonb) from public, anon, authenticated;

-- Trailing-window stats used by the scorer (z-score of |delta_notional| vs this wallet's own history).
create or replace function public.wallet_event_stats(p_wallet_id uuid, p_days integer default 30)
returns table (n bigint, mean numeric, stddev numeric)
language sql
stable
security invoker
set search_path = ''
as $$
  select count(*), avg(abs(delta_notional_usd)), coalesce(stddev_samp(abs(delta_notional_usd)), 0)
  from public.position_events
  where wallet_id = p_wallet_id
    and created_at > now() - make_interval(days => p_days)
    and filter_reason is distinct from 'dust';
$$;

-- Retention: prune raw data older than p_days. Events, threads and cluster alerts are kept.
create or replace function public.prune_old_data(p_days integer default 30)
returns table (fills_deleted bigint, snapshots_deleted bigint, heartbeats_deleted bigint)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cutoff_ms bigint := (extract(epoch from now() - make_interval(days => p_days)) * 1000)::bigint;
  v_fills bigint; v_snaps bigint; v_hb bigint;
begin
  delete from public.fills where time < v_cutoff_ms;
  get diagnostics v_fills = row_count;
  -- flat positions whose last commit is older than the retention window
  delete from public.position_snapshots
   where szi = 0 and committed_at < now() - make_interval(days => p_days);
  get diagnostics v_snaps = row_count;
  delete from public.worker_heartbeats where updated_at < now() - make_interval(days => p_days);
  get diagnostics v_hb = row_count;
  return query select v_fills, v_snaps, v_hb;
end;
$$;
revoke execute on function public.prune_old_data(integer) from public, anon, authenticated;

-- Schedule nightly prune if pg_cron is enabled (Dashboard -> Database -> Extensions -> pg_cron).
-- The worker also runs prune_old_data daily as a fallback.
do $outer$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('sma-prune-nightly', '0 3 * * *', $cron$select public.prune_old_data(30)$cron$);
  end if;
exception when others then
  raise notice 'pg_cron schedule skipped: %', sqlerrm;
end
$outer$;
