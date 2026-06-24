-- 046: 마켓 리포트 카탈로그 (주간/월간 PDF 발행 인덱스 — 프론트 "마켓 리포트" 랜딩/아카이브용)
--   weekly_reports(030)은 웹 가독 원본으로 그대로 두고,
--   본 테이블은 주간+월간 PDF를 하나의 통합 카탈로그로 노출한다.
CREATE TABLE IF NOT EXISTS reports (
  id            TEXT PRIMARY KEY,          -- 'weekly-2026-06-15' | 'monthly-2026-05-01'
  type          TEXT NOT NULL,             -- 'weekly' | 'monthly'
  period_start  DATE NOT NULL,             -- 주간=해당 주 월요일 / 월간=해당 월 1일
  period_end    DATE NOT NULL,
  period_label  TEXT NOT NULL,             -- '25주차 · 06.15–06.21' | '2026년 5월호'
  title         TEXT NOT NULL,
  summary       TEXT,
  pdf_path      TEXT NOT NULL,             -- 스토리지 경로 (reports 버킷)
  pdf_url       TEXT NOT NULL,             -- 공개 URL
  web_url       TEXT,                      -- 웹 가독형 경로(없으면 NULL → 프론트는 PDF로 폴백)
  cover_url     TEXT,                      -- 표지 썸네일(없으면 프론트가 타입색 표지 렌더)
  published_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_read"     ON reports FOR SELECT TO anon         USING (true);
CREATE POLICY "service_write" ON reports FOR ALL   TO service_role USING (true);

CREATE INDEX IF NOT EXISTS reports_type_period_idx ON reports (type, period_start DESC);
