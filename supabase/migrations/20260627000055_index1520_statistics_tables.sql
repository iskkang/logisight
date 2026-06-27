-- Index1520 통계 ETL 테이블 (periods 신규 판단 + transit-service / cities / countries / provinces).
-- scripts/fetch-index1520.mjs 가 service_role로 upsert. 원본 응답은 raw(jsonb)에 보존.

create table if not exists index1520_period_status (
  id bigint generated always as identity primary key,
  source text not null default 'index1520',
  max_reporting_date date not null unique,
  checked_at timestamptz not null default now(),
  raw jsonb
);

create table if not exists index1520_transit_service (
  id bigint generated always as identity primary key,

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
    period_from,
    period_to,
    departure_station_id,
    destination_station_id
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
