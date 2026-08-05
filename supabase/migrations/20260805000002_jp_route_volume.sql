-- 航路別荷動き — 日本海事センター(JPMAC)。
--
-- 일본판 리포트가 정직하게 남겨둔 마지막 결손이었다. 지금 가진 물량 지표는
-- 港湾統計(일본 항구의 TEU)뿐인데, 그건 "어느 항로로 갔는가"를 말해주지 않는다.
-- JPMAC은 일본발 화물을 항로 단위로 낸다 — 2026년 6월 북미 왕항에서
-- 日本 53,701TEU(▲3.2%)인 반면 中国은 954,767TEU(+25.5%)다.
-- 이 대비는 다른 어느 축에서도 안 나온다.
--
-- 두 항로의 성격이 다르다:
--   north_america (PIERS)  — 국가별. 일본 단독 수치가 나온다.
--   europe        (CTS)    — 지역별만. 일본은 北東アジア에 묶인다.
-- scope 컬럼으로 구분한다. 지역 행을 국가로 오해하면 합계가 두 배가 된다.
--
-- DO NOT APPLY automatically — Supabase SQL Editor에서 수동 적용.

create table if not exists public.jp_route_volume (
  id           bigserial primary key,
  -- 'north_america' | 'europe'
  trade        text        not null,
  -- '往航'(아시아→목적지) | '復航'
  direction    text        not null,
  year         int         not null,
  month        int         not null check (month between 1 and 12),
  -- 'total' | 'region' | 'country'. 합산할 때 섞으면 안 된다.
  scope        text        not null check (scope in ('total', 'region', 'country')),
  name         text        not null,
  teu          bigint,
  yoy_pct      numeric,
  share_pct    numeric,
  -- 연초부터의 누계. 단월만으로는 흐름이 안 보인다.
  cum_teu      bigint,
  cum_yoy_pct  numeric,
  source       text        not null,
  source_url   text,
  -- JPMAC이 그 회차를 발표한 날. 우리가 받은 날(fetched_at)과 다르다.
  published_at date,
  fetched_at   timestamptz not null default now(),

  unique (trade, direction, year, month, name)
);

comment on table public.jp_route_volume is
  '航路別コンテナ荷動き(JPMAC)。일본발 물동량을 항로 단위로 담는다. scope로 합계·지역·국가를 구분한다.';

create index if not exists jp_route_volume_period_idx
  on public.jp_route_volume (trade, direction, year desc, month desc);
create index if not exists jp_route_volume_name_idx
  on public.jp_route_volume (name, year desc, month desc);

alter table public.jp_route_volume enable row level security;

-- 공개 데이터다. 읽기는 열고 쓰기는 service_role만.
drop policy if exists jp_route_volume_read on public.jp_route_volume;
create policy jp_route_volume_read on public.jp_route_volume
  for select to anon, authenticated
  using (true);
