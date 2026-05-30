-- 019: 정책 알림 (CBAM, EU ETS, 미국 관세 등 무역 규제 알림)
CREATE TABLE IF NOT EXISTS policy_alerts (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  code          TEXT NOT NULL,
  title         TEXT NOT NULL,
  meta          TEXT,
  is_active     BOOLEAN DEFAULT true,
  display_order INTEGER,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE policy_alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_read" ON policy_alerts FOR SELECT TO anon USING (true);
CREATE POLICY "service_write" ON policy_alerts FOR ALL TO service_role USING (true);
