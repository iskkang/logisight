-- 원격 DB 에만 있던 마이그레이션을 복원한 것.
-- 2026-09-28~30 에 저장소를 거치지 않고 적용돼(대시보드 SQL 편집기로 보인다)
-- supabase_migrations.schema_migrations 에만 기록돼 있었다. 그 statements 를
-- 그대로 옮겨 적는다 —— 내용을 손대지 않는다. 이력과 파일을 맞추는 것이 목적이다.

update public.eu_origin_rules
set rule_code='TEXTILE_CH61',
    rule_text_ko='HS 제61류: ① 천연·인조 스테이플섬유의 방적 또는 인조필라멘트사의 압출과 편직을 함께 수행하거나, ② 편직과 재단을 포함한 봉제·조립(making-up)을 수행해야 합니다.',
    rule_text_en='Spinning of natural and/or man-made staple fibres, or extrusion of man-made filament yarn, accompanied by knitting (knitted to shape products); or knitting and making up including cutting (assembling two or more pieces of knitted or crocheted fabric which have been either cut to form or obtained directly to form).',
    rule_json='{"type":"TEXTILE_CH61"}'::jsonb,
    source_url='https://eur-lex.europa.eu/legal-content/EN/TXT/PDF/?uri=OJ:L:2011:127:FULL',
    legal_basis='EU-Korea FTA Protocol on Rules of Origin, Annex II'
where agreement='KR-EU FTA' and hs_prefix='61' and metadata->>'source' is null;
