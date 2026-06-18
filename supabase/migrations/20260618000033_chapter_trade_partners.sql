-- 033: HS 챕터별 교역국 집계 RPC
-- industries HS 드릴다운 "상위 수출 대상국" — item_country(HS10×국가)를 챕터(2자리)×국가로
-- 서버에서 SUM 집계해 소량(≤교역국 수)만 반환. 클라이언트 전수 fetch(수만 행) 회피.

-- hs_code LIKE '84%' 스캔 가속용 인덱스(item_country 한정)
CREATE INDEX IF NOT EXISTS idx_trade_stats_item_country_hs
  ON trade_statistics (stat_type, hs_code)
  WHERE stat_type = 'item_country';

CREATE OR REPLACE FUNCTION chapter_trade_partners(p_chapter text)
RETURNS TABLE (
  country_name   text,
  export_usd     numeric,
  export_weight  numeric,
  import_usd     numeric,
  import_weight  numeric
)
LANGUAGE sql
STABLE
AS $$
  SELECT country_name,
         SUM(export_usd)    AS export_usd,
         SUM(export_weight) AS export_weight,
         SUM(import_usd)    AS import_usd,
         SUM(import_weight) AS import_weight
  FROM trade_statistics
  WHERE stat_type = 'item_country'
    AND country_name IS NOT NULL
    AND hs_code LIKE p_chapter || '%'
  GROUP BY country_name;
$$;

GRANT EXECUTE ON FUNCTION chapter_trade_partners(text) TO anon, authenticated, service_role;
