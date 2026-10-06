-- 원격 DB 에만 있던 마이그레이션을 복원한 것.
-- 2026-09-28~30 에 저장소를 거치지 않고 적용돼(대시보드 SQL 편집기로 보인다)
-- supabase_migrations.schema_migrations 에만 기록돼 있었다. 그 statements 를
-- 그대로 옮겨 적는다 —— 내용을 손대지 않는다. 이력과 파일을 맞추는 것이 목적이다.

update public.customs_nomenclature
set is_leaf = false
where market='EU' and nomenclature='CN'
  and code ~ '^0';
