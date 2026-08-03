-- 뉴스레터 발송 이벤트 (Resend 웹훅 적재 — 개인정보 포함, anon 접근 금지)
-- 오픈율 측정용. resend.batch.send는 수신자별 개별 메일이라 캠페인 단위 집계가
-- Resend 대시보드에 없다. 이벤트를 우리 DB에 쌓아 회차별 오픈율을 산출한다.
CREATE TABLE IF NOT EXISTS email_events (
  id          BIGSERIAL PRIMARY KEY,
  email_id    TEXT NOT NULL,               -- Resend 메시지 id
  type        TEXT NOT NULL
    CHECK (type IN ('sent', 'delivered', 'opened', 'clicked', 'bounced', 'complained')),
  recipient   TEXT,
  subject     TEXT,
  occurred_at TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- 오픈은 수신자가 메일을 열 때마다 발생한다. 유니크 오픈만 남겨야 오픈율이
  -- 100%를 넘지 않는다. 웹훅 재시도에 대한 멱등성도 같이 확보된다.
  UNIQUE (email_id, type)
);

CREATE INDEX IF NOT EXISTS email_events_type_occurred_idx
  ON email_events (type, occurred_at DESC);

ALTER TABLE email_events ENABLE ROW LEVEL SECURITY;
-- 수신자 이메일이 들어가므로 anon 읽기 금지. service_role만 접근.
CREATE POLICY "service_only" ON email_events
  FOR ALL TO service_role USING (true);

-- 발송 회차(발송일 + 제목)별 오픈율.
-- security_invoker: 뷰가 RLS를 우회하지 않도록 호출자 권한으로 실행한다.
CREATE OR REPLACE VIEW v_newsletter_open_rate
WITH (security_invoker = true) AS
WITH sent AS (
  SELECT email_id, subject, occurred_at::date AS sent_on
  FROM email_events
  WHERE type = 'sent'
),
opened AS (
  SELECT DISTINCT email_id FROM email_events WHERE type = 'opened'
)
SELECT
  s.sent_on,
  s.subject,
  COUNT(*)                                                              AS sent_count,
  COUNT(o.email_id)                                                     AS opened_count,
  ROUND(COUNT(o.email_id)::numeric / NULLIF(COUNT(*), 0) * 100, 1)      AS open_rate_pct
FROM sent s
LEFT JOIN opened o ON o.email_id = s.email_id
GROUP BY s.sent_on, s.subject
ORDER BY s.sent_on DESC;
