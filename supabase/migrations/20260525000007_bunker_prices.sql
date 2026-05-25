-- supabase/migrations/20260525000007_bunker_prices.sql
-- 벙커유 가격 (VLSFO · IFO380 · MGO — 항구별 일간)

create table if not exists bunker_prices (
  id          bigserial primary key,
  grade       text not null,           -- 'VLSFO' | 'IFO380' | 'MGO'
  port        text not null,           -- 'Singapore' | 'Rotterdam' | 'Fujairah'
  price_usd   double precision,        -- USD/MT. 파싱 실패 시 null
  obs_date    date not null,
  source      text not null default 'Ship & Bunker',
  source_url  text,
  fetched_at  timestamptz not null default now(),
  unique (grade, port, obs_date)
);

alter table bunker_prices enable row level security;

create policy "anon_read" on bunker_prices
  for select to anon using (true);
