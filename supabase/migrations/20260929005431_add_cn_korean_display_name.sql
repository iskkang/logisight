-- 원격 DB 에만 있던 마이그레이션을 복원한 것.
-- 2026-09-28~30 에 저장소를 거치지 않고 적용돼(대시보드 SQL 편집기로 보인다)
-- supabase_migrations.schema_migrations 에만 기록돼 있었다. 그 statements 를
-- 그대로 옮겨 적는다 —— 내용을 손대지 않는다. 이력과 파일을 맞추는 것이 목적이다.

alter table public.customs_nomenclature
  add column if not exists description_ko text;

update public.customs_nomenclature
set description_ko = case code
  when '61091000' then '면으로 만든 티셔츠 및 싱글릿'
  when '33049900' then '기타 미용 또는 피부관리용 조제품'
  else description_ko
end
where market='EU' and nomenclature='CN' and code in ('61091000','33049900');
