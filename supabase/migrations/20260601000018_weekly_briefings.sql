-- 018: 주간 브리핑 (이메일/사이트 주간 브리핑 카드)
CREATE TABLE IF NOT EXISTS weekly_briefings (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  title        TEXT NOT NULL,
  subtitle     TEXT,
  week_of      DATE NOT NULL UNIQUE,
  published_at TIMESTAMPTZ,
  content      TEXT
);

CREATE TABLE IF NOT EXISTS weekly_briefing_points (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  briefing_id   UUID NOT NULL REFERENCES weekly_briefings(id) ON DELETE CASCADE,
  category      TEXT NOT NULL,
  agent_type    TEXT NOT NULL,
  headline      TEXT NOT NULL,
  display_order INTEGER NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE weekly_briefings ENABLE ROW LEVEL SECURITY;
ALTER TABLE weekly_briefing_points ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon_read" ON weekly_briefings FOR SELECT TO anon USING (true);
CREATE POLICY "anon_read" ON weekly_briefing_points FOR SELECT TO anon USING (true);
CREATE POLICY "service_write" ON weekly_briefings FOR ALL TO service_role USING (true);
CREATE POLICY "service_write" ON weekly_briefing_points FOR ALL TO service_role USING (true);
