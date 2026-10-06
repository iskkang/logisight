-- 원격 DB 에만 있던 마이그레이션을 복원한 것.
-- 2026-09-28~30 에 저장소를 거치지 않고 적용돼(대시보드 SQL 편집기로 보인다)
-- supabase_migrations.schema_migrations 에만 기록돼 있었다. 그 statements 를
-- 그대로 옮겨 적는다 —— 내용을 손대지 않는다. 이력과 파일을 맞추는 것이 목적이다.

alter table public.eu_hs_crosswalk drop constraint if exists eu_hs_crosswalk_pkey;
alter table public.eu_hs_crosswalk add primary key (cn2026_code, hs2007_code);
create index if not exists eu_hs_crosswalk_cn2026_idx on public.eu_hs_crosswalk (cn2026_code) where is_active=true;
create index if not exists eu_origin_rules_hs2007_idx on public.eu_origin_rules (agreement, hs_version, hs_prefix) where is_active=true;
