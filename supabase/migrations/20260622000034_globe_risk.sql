-- 기상 리스크 지구본 — 스키마 + RLS.
-- assets(항만/초크포인트) · routes(항로) · asset_risk(예보 환산 리스크) · weather_systems(Phase 2 핀).
-- 읽기는 anon 허용, 쓰기는 service_role(RLS 우회)만 — risk-refresh Edge Function이 upsert.
-- DO NOT APPLY automatically — run manually after review (supabase db push 또는 SQL 에디터).

create extension if not exists pg_cron;
create extension if not exists pg_net;

create table if not exists public.assets (
  id   text primary key,
  name text not null,
  type text not null check (type in ('port','choke')),
  lon  double precision not null,
  lat  double precision not null
);

create table if not exists public.routes (
  id        text primary key,
  name      text not null,
  waypoints jsonb not null,            -- ["shanghai",[60,8],"suez",...]
  chokes    text[] not null default '{}'
);

create table if not exists public.asset_risk (
  asset_id     text references public.assets(id) on delete cascade,
  horizon_days int  not null,          -- 0,3,7,14
  score        int  not null,          -- 0..100
  level        text not null,          -- 'g' | 'a' | 'r'
  driver       text,
  wind_gust    double precision,
  wave_height  double precision,
  precip       double precision,
  updated_at   timestamptz not null default now(),
  primary key (asset_id, horizon_days)
);

-- Phase 2용 (지금은 비워둠 → 핀 없음)
create table if not exists public.weather_systems (
  id           text not null,
  horizon_days int  not null,
  label        text not null,
  color        text default '#EF4444',
  lon          double precision not null,
  lat          double precision not null,
  intensity    int  not null,          -- 0..100
  updated_at   timestamptz not null default now(),
  primary key (id, horizon_days)
);

alter table public.assets          enable row level security;
alter table public.routes          enable row level security;
alter table public.asset_risk      enable row level security;
alter table public.weather_systems enable row level security;

-- 읽기는 anon 허용, 쓰기는 service_role(RLS 우회)만
create policy "read assets"   on public.assets          for select using (true);
create policy "read routes"   on public.routes          for select using (true);
create policy "read risk"     on public.asset_risk      for select using (true);
create policy "read systems"  on public.weather_systems for select using (true);
