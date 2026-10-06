-- 원격 DB 에만 있던 마이그레이션을 복원한 것.
-- 2026-09-28~30 에 저장소를 거치지 않고 적용돼(대시보드 SQL 편집기로 보인다)
-- supabase_migrations.schema_migrations 에만 기록돼 있었다. 그 statements 를
-- 그대로 옮겨 적는다 —— 내용을 손대지 않는다. 이력과 파일을 맞추는 것이 목적이다.

alter table public.customs_nomenclature enable row level security;
revoke all on table public.customs_nomenclature from anon, authenticated;
grant select on table public.customs_nomenclature to anon, authenticated;
grant select, insert, update, delete on table public.customs_nomenclature to service_role;
drop policy if exists "customs nomenclature public read" on public.customs_nomenclature;
create policy "customs nomenclature public read" on public.customs_nomenclature for select to anon, authenticated using (true);
