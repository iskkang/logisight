-- 원격 DB 에만 있던 마이그레이션을 복원한 것.
-- 2026-09-28~30 에 저장소를 거치지 않고 적용돼(대시보드 SQL 편집기로 보인다)
-- supabase_migrations.schema_migrations 에만 기록돼 있었다. 그 statements 를
-- 그대로 옮겨 적는다 —— 내용을 손대지 않는다. 이력과 파일을 맞추는 것이 목적이다.

create table if not exists public.eu_origin_rules (
  id bigserial primary key,
  agreement text not null default 'KR-EU FTA',
  hs_prefix text not null,
  hs_version integer not null default 2007,
  rule_code text not null,
  rule_text_ko text not null,
  rule_text_en text,
  rule_json jsonb not null default '{}'::jsonb,
  source_url text not null,
  legal_basis text,
  is_active boolean not null default true,
  valid_from date,
  valid_to date,
  created_at timestamptz not null default now()
);
create index if not exists eu_origin_rules_lookup_idx on public.eu_origin_rules (agreement, hs_prefix, is_active);

delete from public.eu_origin_rules where agreement='KR-EU FTA' and hs_prefix in ('61','390740','901849');

insert into public.eu_origin_rules
(agreement,hs_prefix,hs_version,rule_code,rule_text_ko,rule_text_en,rule_json,source_url,legal_basis,valid_from,is_active)
values
('KR-EU FTA','61',2007,'FABRIC_FORWARD',
 '의류는 한-EU FTA 원산지 판정 시 직물기준(Fabric Forward)을 적용하는 것으로 관세청 활용안내에 제시되어 있습니다. 실제 판정에는 투입 원단의 원산지 지위와 국내 가공공정 확인이 필요합니다.',
 'Apparel: fabric-forward origin assessment; verify originating status of fabric and sufficient processing in Korea.',
 '{"type":"FABRIC_FORWARD","requires":["manufactured_in_kr","fabric_originating","sufficient_processing"],"confidence":"guidance"}'::jsonb,
 'https://www2.customs.go.kr/ftaportalkor/cm/cntnts/cntntsView.do?cntntsId=996&mi=3317',
 'Korea Customs Service EU-Korea FTA utilization guidance', '2026-01-01', true),

('KR-EU FTA','390740',2007,'CTH',
 '모든 호(그 제품의 호는 제외)에 해당하는 재료로부터 생산된 것(CTH).',
 'Manufacture from materials of any heading except that of the product (CTH).',
 '{"type":"CTH"}'::jsonb,
 'https://www.customs.go.kr/upload/call/FTA.pdf',
 'EU-Korea FTA Protocol Annex II; KCS interpretation example', '2026-01-01', true),

('KR-EU FTA','901849',2007,'CTH_OR_MC45',
 '다음 중 하나: ① 모든 호(그 제품의 호는 제외)에 해당하는 재료로부터 생산(CTH), 또는 ② 비원산지재료 가격이 공장도가격의 45% 이하(MC45).',
 'Either CTH or value of all non-originating materials does not exceed 45% of ex-works price.',
 '{"type":"OR","rules":[{"type":"CTH"},{"type":"MC","maxPercent":45}]}'::jsonb,
 'https://www.customs.go.kr/download/ftaportalkor/ebook/FTA-20200608_1/autoalbum/page/200608115711419/RealData/%EC%9B%90%EC%82%B0%EC%A7%80%EA%B2%B0%EC%A0%95%EA%B8%B0%EC%A4%80%20%EC%9C%84%EB%B0%98%EC%82%AC%EB%A1%80%2060%EC%84%A0.pdf',
 'EU-Korea FTA Protocol Annex II; Seoul Main Customs case guidance', '2026-01-01', true);
