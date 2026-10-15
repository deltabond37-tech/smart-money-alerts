-- Seed: 3 sample wallets (REPLACE with your real tracked addresses), default rules, coin tiers.
-- Idempotent (on conflict do nothing / update).

insert into public.wallets (address, label, tier, is_priority, notes) values
  ('0x0000000000000000000000000000000000000a01', 'Sample Whale A',  'A', true,  'placeholder - replace with a real address'),
  ('0x0000000000000000000000000000000000000b02', 'Sample Fund B',   'B', false, 'placeholder - replace with a real address'),
  ('0x0000000000000000000000000000000000000c03', 'Sample Trader C', 'C', false, 'placeholder - replace with a real address')
on conflict (address) do nothing;

-- Global defaults. Keys mirror the Thresholds schema in @sma/core (partial overrides allowed per scope).
insert into public.alert_rules (scope, scope_ref, name, event_types, thresholds, routing) values
  ('global', null, 'Global defaults',
   array['OPEN','CLOSE','INCREASE','DECREASE','FLIP'],
   '{
     "min_delta_notional_usd": 25000,
     "min_pct_change": 25,
     "min_equity_pct": 2,
     "min_leverage": 0,
     "max_leverage": 100,
     "coin_whitelist": [],
     "coin_blacklist": [],
     "close_min_realized_pnl_usd": 5000,
     "cooldown_sec": 1800,
     "dust": { "pct": 5, "usd": 2000 },
     "mm": { "fills_per_day": 200, "drift_ratio": 0.1 },
     "score": { "high": 70, "low": 40 },
     "cluster": { "k": 3, "t_min": 60 },
     "agg_window_sec": 120,
     "thread_broadcast_min_score": 85,
     "zscore_min_samples": 5
   }'::jsonb,
   '{}'::jsonb)
on conflict (scope, coalesce(scope_ref, '')) do update
  set thresholds = excluded.thresholds, event_types = excluded.event_types;

-- Per-coin-tier size thresholds (majors need bigger moves to matter; long tail is noisier -> stricter dust)
insert into public.alert_rules (scope, scope_ref, name, thresholds) values
  ('coin_tier', 'major',     'Majors: higher notional bar',          '{ "min_delta_notional_usd": 50000 }'::jsonb),
  ('coin_tier', 'mid',       'Mid caps',                             '{ "min_delta_notional_usd": 25000 }'::jsonb),
  ('coin_tier', 'long_tail', 'Long tail: lower bar, stricter dust',  '{ "min_delta_notional_usd": 10000, "dust": { "pct": 10, "usd": 2000 } }'::jsonb)
on conflict (scope, coalesce(scope_ref, '')) do update set thresholds = excluded.thresholds;

insert into public.coin_tiers (coin, tier) values
  ('BTC','major'), ('ETH','major'), ('SOL','major'),
  ('HYPE','mid'), ('XRP','mid'), ('DOGE','mid'), ('BNB','mid'), ('SUI','mid'), ('AVAX','mid'),
  ('LINK','mid'), ('ARB','mid'), ('OP','mid'), ('ADA','mid'), ('LTC','mid'), ('TRX','mid'),
  ('WIF','long_tail'), ('PEPE','long_tail'), ('FARTCOIN','long_tail'), ('TIA','long_tail'), ('SEI','long_tail')
on conflict (coin) do update set tier = excluded.tier;
