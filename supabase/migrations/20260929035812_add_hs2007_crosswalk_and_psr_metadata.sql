-- 원격 DB 에만 있던 마이그레이션을 복원한 것.
-- 2026-09-28~30 에 저장소를 거치지 않고 적용돼(대시보드 SQL 편집기로 보인다)
-- supabase_migrations.schema_migrations 에만 기록돼 있었다. 그 statements 를
-- 그대로 옮겨 적는다 —— 내용을 손대지 않는다. 이력과 파일을 맞추는 것이 목적이다.

create table if not exists public.eu_hs_crosswalk (
  cn2026_code text primary key,
  hs2007_code text,
  mapping_type text not null,
  source_url text not null,
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists eu_hs_crosswalk_hs2007_idx on public.eu_hs_crosswalk (hs2007_code);

alter table public.eu_origin_rules
  add column if not exists selector_text text,
  add column if not exists metadata jsonb not null default '{}'::jsonb;
