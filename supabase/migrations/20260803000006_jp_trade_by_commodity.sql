-- 일본 품목별·국가별 수출입 (財務省貿易統計 概況品別国別表)
-- jp_trade_stats(국가별 총액)의 품목 축. 국가 축이 "대중 수출 X%"를 준다면
-- 이쪽은 "대중 기계류 수출 X%"를 준다.
--
-- 최상위 10개 품목(SITC 계열 대분류)만 담는다. 원자료는 품목 404개 계층이지만
-- 국가 222개 × 월 12개를 곱하면 240만 셀이라, 필요해질 때 하위를 넓힌다.
-- 金額만 담는 이유 — 数量은 단위가 품목마다 달라(kg·리터·개) 한 컬럼에 섞으면
-- 합산이 무의미해진다. 단위는 千円이며 unit 컬럼에 남긴다.
--
-- 재실행 안전: 테이블·인덱스·정책 모두 존재 확인 후 생성.
CREATE TABLE IF NOT EXISTS jp_trade_by_commodity (
  id             BIGSERIAL PRIMARY KEY,
  direction      TEXT NOT NULL CHECK (direction IN ('export', 'import')),
  commodity_code TEXT NOT NULL,       -- 概況品目 코드 (70000000 = 機械類及び輸送用機器)
  commodity_name TEXT NOT NULL,
  country_code   TEXT NOT NULL,       -- e-Stat area 코드 (50105 = 中華人民共和国)
  country_name   TEXT NOT NULL,
  year           INT NOT NULL,
  month          INT NOT NULL CHECK (month BETWEEN 1 AND 12),
  value_jpy      BIGINT NOT NULL,     -- 千円
  unit           TEXT NOT NULL DEFAULT 'thousand_jpy',
  source         TEXT,
  source_url     TEXT,
  fetched_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (direction, commodity_code, country_code, year, month)
);

CREATE INDEX IF NOT EXISTS jp_trade_by_commodity_period_idx
  ON jp_trade_by_commodity (year DESC, month DESC, direction);
CREATE INDEX IF NOT EXISTS jp_trade_by_commodity_country_idx
  ON jp_trade_by_commodity (country_code, year DESC, month DESC);

ALTER TABLE jp_trade_by_commodity ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon read jp_trade_by_commodity" ON jp_trade_by_commodity;
CREATE POLICY "anon read jp_trade_by_commodity"
  ON jp_trade_by_commodity FOR SELECT TO anon USING (true);

DROP POLICY IF EXISTS "service write jp_trade_by_commodity" ON jp_trade_by_commodity;
CREATE POLICY "service write jp_trade_by_commodity"
  ON jp_trade_by_commodity FOR ALL TO service_role USING (true);
