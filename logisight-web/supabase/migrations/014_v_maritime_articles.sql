-- 014_v_maritime_articles.sql
-- 웹사이트 기사 전용 뷰 (daily_card·external·짧은 본문 자동 제외)
--
-- 웹사이트 기사 조건:
--   agent_type IN ('shipping','corp','brief','weekly_brief')
--   content IS NOT NULL
--   length(content) >= 400

CREATE OR REPLACE VIEW public.v_maritime_articles AS
SELECT *
FROM maritime_news
WHERE agent_type IN ('shipping', 'corp', 'brief', 'weekly_brief')
  AND content IS NOT NULL
  AND length(content) >= 400;

-- anon 읽기 허용 (maritime_news 테이블 RLS 상속)
GRANT SELECT ON public.v_maritime_articles TO anon;
GRANT SELECT ON public.v_maritime_articles TO authenticated;
