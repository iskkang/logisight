-- CIP RNE(RailNetEurope) 유럽 복합운송 터미널 디렉터리.
-- scripts/fetch-cip-terminals.mjs 가 service_role로 upsert(공개 엔드포인트 /api/public/terminals).
-- /rail/eurasia '터미널' 탭에서 anon read.

create table if not exists eu_rail_terminals (
  id bigint primary key,                       -- CIP RNE location id
  name text not null,
  operator text,
  type text,                                   -- Container / Intermodal | Loading / Unloading | Marshalling / Shunting Yard
  corridors text[] not null default '{}',      -- 소속 EU 교통회랑
  address text,
  home_page text,
  info_url text,
  raw jsonb not null,
  fetched_at timestamptz not null default now()
);

create index if not exists eu_rail_terminals_type_idx on public.eu_rail_terminals (type);

-- 프론트 anon 노출용 public read (service_role 쓰기는 RLS 우회).
alter table public.eu_rail_terminals enable row level security;
drop policy if exists eu_rail_terminals_public_read on public.eu_rail_terminals;
create policy eu_rail_terminals_public_read on public.eu_rail_terminals for select using (true);
