-- 020: 뉴스레터 구독자 (개인정보 — anon 접근 금지)
CREATE TABLE IF NOT EXISTS newsletter_subscribers (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  email           TEXT NOT NULL UNIQUE,
  status          TEXT DEFAULT 'active'
    CHECK (status IN ('active', 'unsubscribed')),
  preferences     JSONB,
  source          TEXT,
  subscribed_at   TIMESTAMPTZ DEFAULT NOW(),
  unsubscribed_at TIMESTAMPTZ
);

ALTER TABLE newsletter_subscribers ENABLE ROW LEVEL SECURITY;
-- anon 읽기 금지 (개인정보 보호). service_role만 접근.
CREATE POLICY "service_only" ON newsletter_subscribers
  FOR ALL TO service_role USING (true);
