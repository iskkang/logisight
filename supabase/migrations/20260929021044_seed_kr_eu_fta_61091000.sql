-- 원격 DB 에만 있던 마이그레이션을 복원한 것.
-- 2026-09-28~30 에 저장소를 거치지 않고 적용돼(대시보드 SQL 편집기로 보인다)
-- supabase_migrations.schema_migrations 에만 기록돼 있었다. 그 statements 를
-- 그대로 옮겨 적는다 —— 내용을 손대지 않는다. 이력과 파일을 맞추는 것이 목적이다.

delete from public.eu_customs_measures
where cn_code='61091000'
  and origin_country='KR'
  and measure_type in ('PREFERENCE','REQUIREMENT')
  and metadata->>'source'='EU-Korea FTA';

insert into public.eu_customs_measures
(cn_code,origin_country,destination_country,measure_type,rate_percent,rate_text,title,detail,legal_basis,source_url,valid_from,valid_to,is_active,metadata)
values
('61091000','KR',null,'PREFERENCE',0,'0%','EU-Korea FTA preferential tariff',
 'Preferential tariff applies only where the goods qualify as Korean originating goods under the EU-Korea FTA rules of origin and the required origin declaration/proof is valid.',
 'EU-Korea Free Trade Agreement; Protocol concerning the definition of originating products and methods of administrative cooperation',
 'https://trade.ec.europa.eu/access-to-markets/en/results?destination=DE&origin=KR&product=61091000',
 '2026-01-01','2026-12-31',true,'{"source":"EU-Korea FTA","year":2026,"verification":"Access2Markets/TARIC"}'::jsonb),
('61091000','KR',null,'REQUIREMENT',null,null,'한-EU FTA 원산지 요건 확인',
 '0% 특혜관세를 적용하려면 한-EU FTA의 품목별 원산지 규정을 충족하고 유효한 원산지 신고/증빙을 보유해야 합니다.',
 'EU-Korea Free Trade Agreement rules of origin',
 'https://taxation-customs.ec.europa.eu/customs/rules-origin-goods/preferential-rules-origin_en',
 '2026-01-01','2026-12-31',true,'{"source":"EU-Korea FTA","year":2026}'::jsonb);
