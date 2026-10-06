-- 원격 DB 에만 있던 마이그레이션을 복원한 것.
-- 2026-09-28~30 에 저장소를 거치지 않고 적용돼(대시보드 SQL 편집기로 보인다)
-- supabase_migrations.schema_migrations 에만 기록돼 있었다. 그 statements 를
-- 그대로 옮겨 적는다 —— 내용을 손대지 않는다. 이력과 파일을 맞추는 것이 목적이다.

update public.customs_nomenclature
set description_ko='휴대용 자동자료처리기계(노트북), 중량 10kg 이하, 중앙처리장치·키보드·디스플레이 포함'
where market='EU' and nomenclature='CN' and code='84713000';

update public.eu_customs_measures
set rate_percent=0,
    rate_text='0%',
    detail='EU conventional third-country duty verified as 0% for CN 84713000; corrected from malformed PDF column parsing.',
    metadata=coalesce(metadata,'{}'::jsonb) || '{"manual_correction":"2026-09-30","verification":"EU Access2Markets/TARIC"}'::jsonb
where cn_code='84713000'
  and origin_country is null
  and measure_type='THIRD_COUNTRY_DUTY'
  and is_active=true;

delete from public.eu_product_regulations
where cn_prefix='8471' and source_version='2026-09-30-laptop-electronics';

insert into public.eu_product_regulations
(cn_prefix,category,title,detail,legal_basis,source_url,condition_keywords,is_active,source_version)
values
('8471','EMC',
 'EU Electromagnetic Compatibility (EMC) Directive',
 '노트북 등 전기·전자기기는 전자파 적합성 요건 검토가 필요합니다. 적용 범위와 적합성평가, 기술문서 및 CE 표시 요건을 제품 구성에 따라 확인해야 합니다.',
 'Directive 2014/30/EU',
 'https://single-market-economy.ec.europa.eu/sectors/electrical-and-electronic-engineering-industries-eei/electromagnetic-compatibility-emc-directive_en',
 '{}'::text[],true,'2026-09-30-laptop-electronics'),
('8471','RoHS',
 'EU RoHS Directive',
 '전기·전자제품에 포함된 특정 유해물질 제한 요건을 확인해야 합니다.',
 'Directive 2011/65/EU',
 'https://environment.ec.europa.eu/topics/waste-and-recycling/rohs-directive_en',
 '{}'::text[],true,'2026-09-30-laptop-electronics'),
('8471','WEEE',
 'EU WEEE requirements',
 'EU에서 전기·전자제품을 시장에 출시하는 경우 WEEE 생산자책임, 등록·표시·회수 관련 의무가 발생할 수 있습니다.',
 'Directive 2012/19/EU',
 'https://environment.ec.europa.eu/topics/waste-and-recycling/waste-electrical-and-electronic-equipment-weee_en',
 '{}'::text[],true,'2026-09-30-laptop-electronics'),
('8471','Battery',
 'EU Batteries Regulation',
 '배터리를 내장하거나 동봉한 노트북은 배터리 관련 지속가능성·표시·생산자책임 등 적용 요건을 별도로 확인해야 합니다.',
 'Regulation (EU) 2023/1542',
 'https://environment.ec.europa.eu/topics/waste-and-recycling/batteries_en',
 array['battery','batteries','배터리','노트북','laptop']::text[],true,'2026-09-30-laptop-electronics'),
('8471','RED',
 'EU Radio Equipment Directive (무선 기능이 있는 경우)',
 'Wi‑Fi, Bluetooth 등 무선 송수신 기능이 있는 모델은 RED 적용 여부와 관련 적합성평가를 추가 확인해야 합니다.',
 'Directive 2014/53/EU',
 'https://single-market-economy.ec.europa.eu/sectors/electrical-and-electronic-engineering-industries-eei/radio-equipment-directive-red_en',
 array['wifi','wi-fi','bluetooth','무선','wireless']::text[],true,'2026-09-30-laptop-electronics');
