-- 20260529000013_agent_type_expand.sql
-- agent_type CHECK constraint에 'daily_card', 'external', 'weekly_brief' 추가
-- 배경: 뉴스레터 브리핑 카드(daily_card)와 웹사이트 기사(shipping/corp/brief)를
--       DB 레벨에서 구분

ALTER TABLE maritime_news DROP CONSTRAINT IF EXISTS maritime_news_agent_type_check;

ALTER TABLE maritime_news
  ADD CONSTRAINT maritime_news_agent_type_check
  CHECK (agent_type IS NULL OR agent_type IN (
    'shipping',
    'corp',
    'brief',
    'weekly_brief',
    'daily_card',
    'external'
  ));

CREATE INDEX IF NOT EXISTS idx_maritime_news_agent_type
  ON maritime_news(agent_type, published_at DESC) WHERE agent_type IS NOT NULL;
