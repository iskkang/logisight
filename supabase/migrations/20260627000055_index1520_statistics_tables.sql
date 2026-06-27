-- Index1520 통계 ETL + 라우트 지도용 테이블.
-- scripts/fetch-index1520.mjs 가 service_role로 upsert(원본 응답은 raw jsonb 보존).
-- 프론트(logisight-core)는 anon 키로 select → 아래 테이블에 RLS public-read 정책 부여.

create table if not exists index1520_period_status (
  id bigint generated always as identity primary key,
  source text not null default 'index1520',
  max_reporting_date date not null unique,
  current_period text,
  previous_period text,
  checked_at timestamptz not null default now(),
  raw jsonb
);

create table if not exists index1520_transit_service (
  id bigint generated always as identity primary key,

  period text not null,
  previous_period text,
  period_from date not null,
  period_to date not null,

  departure_station_id text,
  departure_station_name text,
  destination_station_id text,
  destination_station_name text,

  current_teu numeric,
  current_actual_weight numeric,
  current_shipping_qty numeric,
  current_transit_time numeric,

  previous_teu numeric,
  previous_actual_weight numeric,
  previous_shipping_qty numeric,
  previous_transit_time numeric,

  relative_teu numeric,
  relative_actual_weight numeric,
  relative_shipping_qty numeric,
  relative_transit_time numeric,

  raw jsonb,
  fetched_at timestamptz not null default now(),

  unique (
    period,
    previous_period,
    departure_station_id,
    destination_station_id
  )
);

create table if not exists index1520_route_statistics (
  id bigint generated always as identity primary key,

  period text not null,
  previous_period text,

  departure_id text,
  departure_name text,
  destination_id text,
  destination_name text,

  current_teu numeric,
  previous_teu numeric,
  relative_teu numeric,

  current_actual_weight numeric,
  previous_actual_weight numeric,
  relative_actual_weight numeric,

  current_shipping_qty numeric,
  previous_shipping_qty numeric,
  relative_shipping_qty numeric,

  current_transit_time numeric,
  previous_transit_time numeric,
  relative_transit_time numeric,

  raw jsonb,
  fetched_at timestamptz not null default now(),

  unique (
    period,
    previous_period,
    departure_id,
    destination_id
  )
);

create table if not exists index1520_cities (
  id text primary key,
  id_countries text,
  country_set text,
  name text,
  raw jsonb,
  fetched_at timestamptz not null default now()
);

create table if not exists index1520_countries (
  id text primary key,
  id_countries text,
  country_set text,
  name text,
  raw jsonb,
  fetched_at timestamptz not null default now()
);

create table if not exists index1520_provinces (
  id text primary key,
  id_countries text,
  country_set text,
  name text,
  raw jsonb,
  fetched_at timestamptz not null default now()
);

-- Mapbox/maplibre 렌더링용 좌표. Index1520 API는 위경도를 제공하지 않으므로 수동 시드(seed) 후 점진 개선.
-- 좌표가 없으면 라우트는 표에는 보이되 지도에는 그리지 않음.
create table if not exists index1520_locations (
  id text primary key,
  name text not null,
  normalized_name text,
  location_type text, -- station, city, country, province, terminal
  country_code text,
  latitude numeric,
  longitude numeric,
  raw jsonb,
  updated_at timestamptz not null default now()
);

-- RLS: 프론트가 anon으로 읽는 테이블에 public read 정책 (service_role 쓰기는 RLS 우회).
do $$
declare t text;
begin
  foreach t in array array[
    'index1520_period_status','index1520_transit_service','index1520_route_statistics',
    'index1520_cities','index1520_countries','index1520_provinces','index1520_locations'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_public_read', t);
    execute format('create policy %I on public.%I for select using (true)', t || '_public_read', t);
  end loop;
end $$;
