-- 20260801000001_v_maritime_articles_security_invoker.sql
-- v_maritime_articles를 invoker 권한으로 전환 (Supabase Security Advisor: security_definer_view)
--
-- PG15+ 뷰 기본값은 정의자(postgres) 권한 실행 → 하위 maritime_news의 RLS가 소유자 기준으로
-- 평가돼 사실상 우회된다. 지금은 anon_read 정책이 using(true)라 실피해가 없지만,
-- 나중에 maritime_news에 초안·엠바고 행을 두고 RLS를 조이면 이 뷰만 조용히 흘린다.
-- 본문은 20260529000014_v_maritime_articles.sql과 동일 — security_invoker만 추가.
-- CREATE OR REPLACE는 기존 GRANT를 유지하므로 재부여 불필요.

CREATE OR REPLACE VIEW public.v_maritime_articles
WITH (security_invoker = on) AS
SELECT *
FROM maritime_news
WHERE agent_type IN ('shipping', 'corp', 'brief', 'weekly_brief')
  AND content IS NOT NULL
  AND length(content) >= 400;
