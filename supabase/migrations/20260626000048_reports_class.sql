-- 048: reports 분류 필드(report_class/region/iso_week) 추가 + 백필
--   type(weekly/monthly = 발행 주기)은 유지. report_class가 종합/권역 구분을 추가한다.
--   프론트가 월간 / 주간 종합 / 주간 권역을 정확히 나누고, 권역은 주차×권역 매트릭스로 렌더한다.
--   CC는 파일만 작성. 적용/실행은 수동.
alter table reports add column if not exists report_class text;
alter table reports add column if not exists region       text;
alter table reports add column if not exists iso_week     text;

-- 백필 1: 기본값 = type (monthly→monthly, weekly→weekly)
update reports set report_class = type where report_class is null;

-- 백필 2: 권역 리포트 식별(제목에 '권역') → weekly_regional + region 추출
update reports set
  report_class = 'weekly_regional',
  region = case
    when title like '%극동%' or period_label like '%극동%' then '극동(러시아·CIS)'
    when title like '%유럽%' or period_label like '%유럽%' then '유럽'
    when title like '%미주%' or period_label like '%미주%' then '미주'
    when title like '%남미%' or period_label like '%남미%' then '남미'
    when title like '%중국%' or period_label like '%중국%' then '중국'
    when title like '%일본%' or period_label like '%일본%' then '일본'
    when title like '%동남아%' or period_label like '%동남아%' then '동남아'
    when title like '%중동%' or period_label like '%중동%' then '중동'
    when title like '%아프리카%' or period_label like '%아프리카%' then '아프리카'
    else region end
where title like '%권역%';

-- 백필 3: iso_week — weekly 계열 id/pdf_path에서 'YYYY-Www' 추출(있으면)
update reports
set iso_week = substring(coalesce(id, pdf_path) from '(\d{4}-W\d{2})')
where report_class in ('weekly','weekly_regional') and iso_week is null;

-- 제약(기존행 안 깨지게 not valid) + 인덱스. 재실행 가능하도록 drop if exists 후 재생성.
alter table reports drop constraint if exists reports_class_chk;
alter table reports
  add constraint reports_class_chk check (report_class in ('monthly','weekly','weekly_regional')) not valid;
create index if not exists idx_reports_class on reports (report_class, period_start desc);
