-- 028: 유라시아 회랑 구간별 지연 원인 분해
-- disruption_events(어드민 수기)와 달리 파이프라인 자동 분석용
-- delay_contribution_days: 해당 구간이 전체 지연에 기여한 일수
-- confidence: 분석 신뢰도 0.0~1.0
CREATE TABLE IF NOT EXISTS eurasia_disruptions (
  id                       UUID    DEFAULT gen_random_uuid() PRIMARY KEY,
  lane_id                  TEXT    NOT NULL REFERENCES lanes(id),
  segment                  TEXT    NOT NULL,  -- 예: BREST_BORDER, KAZAKH_TRANSIT, RUSSIAN_MAIN
  category                 TEXT,
  severity                 TEXT    NOT NULL DEFAULT 'medium'
    CHECK (severity IN ('critical','high','medium','low')),
  started_at               DATE    NOT NULL,
  resolved_at              DATE,
  delay_contribution_days  NUMERIC(5, 1),
  confidence               NUMERIC(3, 2)
    CHECK (confidence BETWEEN 0 AND 1),
  title_ko                 TEXT,
  title_en                 TEXT,
  impact_description       TEXT,
  source                   TEXT,
  verified_by              TEXT,
  created_at               TIMESTAMPTZ DEFAULT NOW(),
  updated_at               TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_eurasia_disruptions_lane
  ON eurasia_disruptions (lane_id, started_at DESC);

ALTER TABLE eurasia_disruptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_read"    ON eurasia_disruptions FOR SELECT TO anon         USING (true);
CREATE POLICY "service_write" ON eurasia_disruptions FOR ALL   TO service_role USING (true);
