-- 원격 DB 에만 있던 마이그레이션을 복원한 것.
-- 2026-09-28~30 에 저장소를 거치지 않고 적용돼(대시보드 SQL 편집기로 보인다)
-- supabase_migrations.schema_migrations 에만 기록돼 있었다. 그 statements 를
-- 그대로 옮겨 적는다 —— 내용을 손대지 않는다. 이력과 파일을 맞추는 것이 목적이다.

delete from public.customs_nomenclature
where market='EU'
  and nomenclature='CN'
  and code like '00%';

do $$
declare
  remaining_bad integer;
  valid_cn8 integer;
begin
  select count(*) into remaining_bad
  from public.customs_nomenclature
  where market='EU' and nomenclature='CN' and code like '00%';

  select count(*) into valid_cn8
  from public.customs_nomenclature
  where market='EU' and nomenclature='CN'
    and is_active=true and level=8 and code ~ '^[0-9]{8}$';

  if remaining_bad <> 0 then
    raise exception 'invalid 00-prefix CN rows remain: %', remaining_bad;
  end if;
  if valid_cn8 < 9000 then
    raise exception 'suspicious CN8 count after cleanup: %', valid_cn8;
  end if;
end $$;
