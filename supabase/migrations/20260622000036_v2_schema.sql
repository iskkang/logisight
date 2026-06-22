-- 기상 리스크 지구본 v2 — 스키마 변경.
-- (1) assets에 'rail' 타입 + freeze_prone 플래그, (2) asset_risk에 폭설/한파/결빙 변수,
-- (3) events 테이블 — 전 세계 재해 피드(NHC/GDACS/NWS) 동적 감지 결과 (고정 자산과 분리).
-- DO NOT APPLY automatically — run manually after review (v1: ...034/...035 이후).

-- assets: 'rail' 타입 허용 + 결빙 플래그
alter table public.assets drop constraint if exists assets_type_check;
alter table public.assets add constraint assets_type_check check (type in ('port','choke','rail'));
alter table public.assets add column if not exists freeze_prone boolean not null default false;

-- asset_risk: 신규 해저드 변수
alter table public.asset_risk add column if not exists snowfall double precision;
alter table public.asset_risk add column if not exists temp_min double precision;
alter table public.asset_risk add column if not exists is_freeze boolean not null default false;

-- events: 글로벌 피드 감지 결과 (고정 자산과 분리, 동적)
create table if not exists public.events (
  id         text primary key,         -- 'nhc:AL05', 'gdacs:1012345', 'nws:...'
  source     text not null,            -- 'nhc' | 'gdacs' | 'nws'
  kind       text not null,            -- 'cyclone' | 'storm' | 'flood' | 'snow' | 'other'
  title      text not null,
  severity   text not null,            -- 'a' | 'r'
  lon        double precision,
  lat        double precision,
  area       text,
  starts_at  timestamptz,
  ends_at    timestamptz,
  url        text,
  updated_at timestamptz not null default now()
);
alter table public.events enable row level security;
create policy "read events" on public.events for select using (true);
