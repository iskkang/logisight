-- ============================================================================
-- Logisight Seed (Delta) — 002 마이그레이션 이후 실행
-- 멱등성: ON CONFLICT 처리로 여러 번 실행해도 안전.
-- 기존 freight_indices, maritime_news의 기존 데이터는 건드리지 않음.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Weekly Briefing — 이번 주
-- ----------------------------------------------------------------------------
WITH upsert_briefing AS (
  INSERT INTO weekly_briefings (title, subtitle, week_of, published_at)
  VALUES (
    '주간 시장 브리핑',
    '2026년 5월 4주 · 운임 · 기업 · 글로벌',
    '2026-05-25',
    '2026-05-28 09:00:00+09'
  )
  ON CONFLICT (week_of) DO UPDATE SET
    title = EXCLUDED.title,
    subtitle = EXCLUDED.subtitle,
    published_at = EXCLUDED.published_at
  RETURNING id
)
INSERT INTO weekly_briefing_points (briefing_id, category, agent_type, headline, display_order)
SELECT id, '시황',   'shipping', '중남미 동안 운임 9개월 만에 4,000弗 돌파',    1 FROM upsert_briefing
UNION ALL
SELECT id, '기업',   'corp',     'DSV, 쉥커 통합 효과로 1분기 매출 69%↑',        2 FROM upsert_briefing
UNION ALL
SELECT id, '글로벌', 'brief',    'TCR 부산-알마티 18일대 진입… 통관 개선',       3 FROM upsert_briefing
ON CONFLICT (briefing_id, display_order) DO UPDATE SET
  category   = EXCLUDED.category,
  agent_type = EXCLUDED.agent_type,
  headline   = EXCLUDED.headline;

-- ----------------------------------------------------------------------------
-- 2. Policy Alerts
-- ----------------------------------------------------------------------------
INSERT INTO policy_alerts (code, title, meta, is_active, display_order) VALUES
  ('CBAM',   '철강·시멘트 7월 본격 적용, 신고 의무화',          'D-30 · 한국 철강 화주 직접 영향', TRUE, 1),
  ('EU ETS', '해운 배출권 100% 적용, 부가비용 발생',            '시행 중 · TEU당 €28 부담',         TRUE, 2),
  ('제재',   '대러 18차 제재 발표, 중앙아 우회 경로 점검',      '5/27 발표 · 카자흐 경유 주의',     TRUE, 3)
ON CONFLICT DO NOTHING;

-- ----------------------------------------------------------------------------
-- 3. Freight Rates (data.go.kr 화물운임공표 연동 전 임시 mock)
-- ----------------------------------------------------------------------------
INSERT INTO freight_rates (
  pol_code, pol_name, pod_code, pod_name, container_type, rate_usd,
  weekly_change_pct, is_featured, data_source, display_order
) VALUES
  ('KRPUS', '부산', 'USLAX', 'LA',      '40DRY', 2890, -2.0, TRUE, '해양수산부 화물운임공표정보', 1),
  ('KRPUS', '부산', 'DEHAM', '함부르크', '40DRY', 2340,  1.0, TRUE, '해양수산부 화물운임공표정보', 2),
  ('KRPUS', '부산', 'CNNGB', '닝보',     '40DRY',  420,  5.0, TRUE, '해양수산부 화물운임공표정보', 3),
  ('KRICN', '인천', 'VNSGN', '호치민',   '40DRY',  680, -1.0, TRUE, '해양수산부 화물운임공표정보', 4)
ON CONFLICT DO NOTHING;

-- ----------------------------------------------------------------------------
-- 4. Maritime News — 홈페이지 표시용 샘플 5건
--    기존 maritime_news 행은 건드리지 않음. URL이 이미 있으면 스킵.
--    실 운영에서는 저널리스트 에이전트가 직접 INSERT 하게 됨.
-- ----------------------------------------------------------------------------
INSERT INTO maritime_news (
  title, summary, url, source, lang, category, agent_type, is_hero, published_at, fetched_at
) VALUES
  (
    '중남미항로 동안 운임 9개월 만에 4000弗 돌파',
    '상하이발 산투스행이 TEU당 4,256달러를 기록하며 전주 대비 29% 급등했다. 브라질 농산물 수출 성수기 진입과 블랭크 세일링 확대가 동시에 운임을 끌어올리고 있다.',
    'https://logisight.mtlship.com/sample/latam-rates-2026-05-28',
    '코리아쉬핑가제트', 'ko', '해상', 'shipping', TRUE,
    '2026-05-28 08:00:00+09', NOW()
  ),
  (
    '에어차이나카고, A350F 화물기 4대 추가 발주',
    '중국 국영 화물항공사가 차세대 대형 화물기 도입을 확대하며 글로벌 장거리 항공화물 시장 경쟁력 강화에 나섰다.',
    'https://logisight.mtlship.com/sample/air-china-a350f',
    'AirCargoNews', 'ko', '항공', 'corp', FALSE,
    '2026-05-27 10:00:00+09', NOW()
  ),
  (
    'TCR Q1 사상 최고 5,460편 운행',
    '중국-유럽 컨테이너 철도 운행이 분기 사상 최고치를 경신했다. 중앙아 환적 효율 개선이 주효했다.',
    'https://logisight.mtlship.com/sample/tcr-q1-record',
    'RailFreight', 'ko', '철도', 'brief', FALSE,
    '2026-05-27 14:00:00+09', NOW()
  ),
  (
    'EU ETS 100% 전환 완료, TEU당 €28 부담',
    '유럽연합 배출권거래제(ETS)가 해운 부문 100% 적용으로 전환되며 한국발 유럽향 화주의 부가비용이 본격화됐다.',
    'https://logisight.mtlship.com/sample/eu-ets-100',
    'Supply Chain Dive', 'ko', '무역', 'brief', FALSE,
    '2026-05-26 18:00:00+09', NOW()
  ),
  (
    'DSV, 쉥커 인수 효과로 1분기 매출 69% 급증',
    '덴마크 물류 공룡 DSV가 쉥커 통합 효과로 분기 매출 69%, 영업이익 31% 증가를 기록했다.',
    'https://logisight.mtlship.com/sample/dsv-q1-schenker',
    'FreightWaves', 'ko', '물류', 'corp', FALSE,
    '2026-05-26 11:00:00+09', NOW()
  )
ON CONFLICT (url) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 5. Data Updates Log
-- ----------------------------------------------------------------------------
INSERT INTO data_updates (dataset, status, notes, updated_at) VALUES
  ('logisight_seed_v1', 'success', 'Initial homepage seed', NOW()),
  ('weekly_briefings',  'success', '주간 브리핑 3건 적재',  NOW()),
  ('policy_alerts',     'success', '정책 알림 3건 활성',    NOW())
ON CONFLICT DO NOTHING;

-- ----------------------------------------------------------------------------
-- 6. (선택) freight_indices에 SCFI/WCI 등 데이터가 없으면 임시 시드
--    이미 데이터가 있으면 스킵. 컬럼명 주의: index_code, value, change_pct, week_date
-- ----------------------------------------------------------------------------
INSERT INTO freight_indices (index_code, value, change_pct, week_date, source, source_url, fetched_at)
SELECT * FROM (VALUES
  ('SCFI',  1954.0::float8,   2.2::float8, '2026-05-22'::date, 'Shanghai Shipping Exchange', NULL::text, NOW()),
  ('WCI',   2286.0::float8,   3.1::float8, '2026-05-22'::date, 'Drewry',                     NULL::text, NOW()),
  ('FBX',   2140.0::float8,  -1.2::float8, '2026-05-22'::date, 'Freightos',                  NULL::text, NOW()),
  ('KCCI',  1821.0::float8,   0.8::float8, '2026-05-26'::date, 'KOBC',                       NULL::text, NOW()),
  ('BAI',      5.16::float8, 12.0::float8, '2026-05-22'::date, 'Baltic Exchange Air',        NULL::text, NOW()),
  ('VLSFO',  812.0::float8,  -2.4::float8, '2026-05-26'::date, 'Ship & Bunker',              NULL::text, NOW())
) AS new_rows(index_code, value, change_pct, week_date, source, source_url, fetched_at)
WHERE NOT EXISTS (
  SELECT 1 FROM freight_indices
  WHERE freight_indices.index_code = new_rows.index_code
    AND freight_indices.week_date  = new_rows.week_date
);
