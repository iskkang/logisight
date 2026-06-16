-- 030: 주간 리포트 게재 저장 (웹 노출 원본)
CREATE TABLE IF NOT EXISTS weekly_reports (
  week_id       TEXT PRIMARY KEY,          -- 'YYYY-Www'
  period_start  DATE NOT NULL,
  period_end    DATE NOT NULL,
  title         TEXT NOT NULL,
  summary_json  JSONB,                     -- execSummary(신호등·근거) + 핵심수치
  body_md       TEXT NOT NULL,
  pdf_url       TEXT,
  published_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE weekly_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_read"     ON weekly_reports FOR SELECT TO anon         USING (true);
CREATE POLICY "service_write" ON weekly_reports FOR ALL   TO service_role USING (true);
