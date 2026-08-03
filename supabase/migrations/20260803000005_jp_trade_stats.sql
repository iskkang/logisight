-- 일본 국가별 수출입 통계 (財務省貿易統計 / 地域(国)別輸出入時系列表)
-- 한국 관세청 기반 trade_statistics와 섞지 않는다. 입도(품목 vs 국가)도,
-- 코드 체계(HS 10자리 vs 국가명)도, 국가명 표기(한글 vs 영문)도 다르다.
--
-- 금액 단위는 千円이다. unit 컬럼에 남겨 나중에 다른 단위가 섞이는 걸 막는다.
--
-- is_aggregate: 'Grand Total'(세계)과 'ASIA' 같은 지역 합계를 표시한다.
-- 국가와 같은 취급으로 합산하면 이중계상된다.
--
-- 재실행 안전: 테이블·인덱스·정책 모두 존재 확인 후 생성.
CREATE TABLE IF NOT EXISTS jp_trade_stats (
  id             BIGSERIAL PRIMARY KEY,
  country_name   TEXT NOT NULL,        -- 공표 원문 영문 표기 (R KOREA, CHINA …)
  region         TEXT,                 -- ASIA, MIDDLE EAST … (세계 총계는 NULL)
  is_aggregate   BOOLEAN NOT NULL DEFAULT FALSE,
  year           INT NOT NULL,
  month          INT NOT NULL CHECK (month BETWEEN 1 AND 12),
  export_jpy     BIGINT,               -- 千円
  import_jpy     BIGINT,               -- 千円
  -- 원자료는 전년동월비를 지수(119.3)로 주지만, 여기에는 증감률(+19.3)로 저장한다.
  -- 최신 월에만 공표되므로 나머지 달은 NULL이다.
  yoy_export_pct NUMERIC,
  yoy_import_pct NUMERIC,
  unit           TEXT NOT NULL DEFAULT 'thousand_jpy',
  source         TEXT,
  source_url     TEXT,
  fetched_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (country_name, year, month)
);

CREATE INDEX IF NOT EXISTS jp_trade_stats_lookup_idx
  ON jp_trade_stats (is_aggregate, year DESC, month DESC);
CREATE INDEX IF NOT EXISTS jp_trade_stats_region_idx
  ON jp_trade_stats (region, year DESC, month DESC);

ALTER TABLE jp_trade_stats ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon read jp_trade_stats" ON jp_trade_stats;
CREATE POLICY "anon read jp_trade_stats"
  ON jp_trade_stats FOR SELECT TO anon USING (true);

DROP POLICY IF EXISTS "service write jp_trade_stats" ON jp_trade_stats;
CREATE POLICY "service write jp_trade_stats"
  ON jp_trade_stats FOR ALL TO service_role USING (true);
