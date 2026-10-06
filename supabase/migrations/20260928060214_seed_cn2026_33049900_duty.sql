-- 원격 DB 에만 있던 마이그레이션을 복원한 것.
-- 2026-09-28~30 에 저장소를 거치지 않고 적용돼(대시보드 SQL 편집기로 보인다)
-- supabase_migrations.schema_migrations 에만 기록돼 있었다. 그 statements 를
-- 그대로 옮겨 적는다 —— 내용을 손대지 않는다. 이력과 파일을 맞추는 것이 목적이다.

insert into public.eu_customs_measures
(cn_code, origin_country, destination_country, measure_type, rate_percent, rate_text, title, detail, legal_basis, source_url, valid_from, valid_to, is_active, metadata)
select '33049900', null, null, 'THIRD_COUNTRY_DUTY', 0, 'Free', 'EU CN 2026 conventional rate of duty',
'Conventional rate of duty in the 2026 Combined Nomenclature: Free.',
'Commission Implementing Regulation (EU) 2025/1926',
'https://eur-lex.europa.eu/eli/reg_impl/2025/1926/oj',
'2026-01-01','2026-12-31',true,'{"source":"EU CN 2026","verified":"legal_text"}'::jsonb
where not exists (
 select 1 from public.eu_customs_measures where cn_code='33049900' and measure_type='THIRD_COUNTRY_DUTY' and is_active=true
);
