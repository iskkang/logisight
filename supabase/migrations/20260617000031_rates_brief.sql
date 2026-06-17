-- 031: AI 운임 인텔리전스 브리프 저장 (홈 화면 소스)
CREATE TABLE IF NOT EXISTS rates_brief (
  week_id      TEXT PRIMARY KEY,        -- 'YYYY-Www' (as_of 기준)
  as_of        DATE NOT NULL,           -- 최신 지수 날짜(KCCI latest)
  signals_json JSONB NOT NULL,          -- [{label,state,basis,...}]
  prose_json   JSONB NOT NULL,          -- {headline,ocean,global,air,outlook}
  generated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE rates_brief ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_read"     ON rates_brief FOR SELECT TO anon         USING (true);
CREATE POLICY "service_write" ON rates_brief FOR ALL   TO service_role USING (true);
