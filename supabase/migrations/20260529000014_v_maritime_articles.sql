-- 20260529000014_v_maritime_articles.sql
-- 웹사이트 기사 전용 뷰 (daily_card·external·짧은 본문 자동 제외)

CREATE OR REPLACE VIEW public.v_maritime_articles AS
SELECT *
FROM maritime_news
WHERE agent_type IN ('shipping', 'corp', 'brief', 'weekly_brief')
  AND content IS NOT NULL
  AND length(content) >= 400;

GRANT SELECT ON public.v_maritime_articles TO anon;
GRANT SELECT ON public.v_maritime_articles TO authenticated;
