-- T1-2: IATA Jet Fuel Price Monitor 헤드라인 적재 테이블.
-- 출처: IATA / S&P Global Platts — 공개 페이지, 등록 불필요.
-- 주간 수집. span_label='weekly' (MoM이 아님 — 위장 금지).
-- DO NOT APPLY automatically — run manually after review.

create table if not exists iata_jet_fuel_weekly (
  id             bigint generated always as identity primary key,
  as_of          date not null,                       -- 수집일(발행일 근사 — 이전 주 금요일 기준)
  price_usd_bbl  numeric not null check (price_usd_bbl > 0),  -- $/bbl 헤드라인 가격
  fuel_wow_pct   numeric,                             -- 전주 대비 변화율(%) — null 허용(파싱 실패)
  span_label     text not null default 'weekly'       -- 스팬 레이블 — 항상 'weekly'
                   check (span_label = 'weekly'),     -- MoM 위장 방지 DB 레벨 강제
  source         text not null default 'IATA / S&P Global Platts Jet Fuel Price Monitor',
  fetched_at     timestamptz not null default now(),
  unique (as_of)
);

alter table iata_jet_fuel_weekly enable row level security;

create policy "iata_jet_fuel_read"
  on iata_jet_fuel_weekly for select
  using (true);

comment on table iata_jet_fuel_weekly is
  'IATA Jet Fuel Price Monitor 주간 헤드라인. WoW 변화율만 제공(MoM 아님). '
  '항공 cost 팩터 참고용. 출처: IATA / S&P Global Platts.';
comment on column iata_jet_fuel_weekly.fuel_wow_pct is
  '전주 대비(WoW) 변화율(%). MoM이 아님 — span_label=weekly 강제.';
comment on column iata_jet_fuel_weekly.span_label is
  '항상 weekly. MoM(monthly)으로 읽어서는 안 됨.';
