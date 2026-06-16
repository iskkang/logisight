-- 029: 종합 경보 스냅샷 (신규/악화/지속/개선/해제 판정)
-- 대시보드 홈 화면의 실시간 경보 뱃지 및 알림 피드 원본
CREATE TABLE IF NOT EXISTS alert_snapshots (
  id               UUID    DEFAULT gen_random_uuid() PRIMARY KEY,
  snapshot_date    DATE    NOT NULL,
  alert_key        TEXT    NOT NULL,  -- 예: TSR_DELAY, SCFI_SPIKE, BLANK_SAILING_EA
  category         TEXT    NOT NULL
    CHECK (category IN ('delay','rate','capacity','policy','weather','geopolitical')),
  severity         TEXT    NOT NULL DEFAULT 'medium'
    CHECK (severity IN ('critical','high','medium','low')),
  change_direction TEXT    NOT NULL DEFAULT 'stable'
    CHECK (change_direction IN ('new','worsening','stable','improving','resolved')),
  metric_value     NUMERIC,
  metric_unit      TEXT,              -- 예: days, %, USD/TEU, USD/kg
  description_ko   TEXT,
  affected_lanes   TEXT[],           -- 영향 노선
  source_table     TEXT,             -- 원본 데이터 테이블
  source_id        UUID,             -- 원본 행 ID (nullable)
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (snapshot_date, alert_key)
);

CREATE INDEX IF NOT EXISTS idx_alert_snapshots_date
  ON alert_snapshots (snapshot_date DESC, severity);

ALTER TABLE alert_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_read"    ON alert_snapshots FOR SELECT TO anon         USING (true);
CREATE POLICY "service_write" ON alert_snapshots FOR ALL   TO service_role USING (true);
