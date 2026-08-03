-- 일본 화물운송 서비스 가격지수 (日本銀行 企業向けサービス価格指数 / SPPI)
-- 일본에는 한국의 운임공표제 같은 실물 운임 공표가 없어, 외항·국제항공 화물운송
-- 가격의 유일한 공식 월차 시계열이 이 지수다. 기준연도 지수(2020=100)라
-- 달러 실물 운임인 freight_indices와 단위가 달라 테이블을 분리한다.
--
-- basis 구분이 핵심이다. 같은 지표가 세 갈래로 공표된다:
--   yen      본계열(엔 베이스) — 운임 변동 + 환율 변동
--   contract 참고계열(계약통화 베이스) — 환율 효과를 뺀 값
--   ex_tax   소비세 제외
-- 외항화물은 달러 계약이라 둘이 크게 벌어진다(2026-06: 엔 233.8 vs 계약통화 160.8).
-- 구분 없이 인용하면 해석이 틀리므로 basis를 키에 포함해 함께 보관한다.
--
-- 재실행 안전: 테이블·인덱스·정책 모두 존재 확인 후 생성.
CREATE TABLE IF NOT EXISTS jp_price_indices (
  id          BIGSERIAL PRIMARY KEY,
  series_code TEXT NOT NULL,          -- 예: PRCS20_5200730001
  series_name TEXT NOT NULL,          -- 예: 外航貨物輸送
  basis       TEXT NOT NULL
    CHECK (basis IN ('yen', 'contract', 'ex_tax')),
  category    TEXT NOT NULL
    CHECK (category IN ('ocean', 'air', 'land', 'port', 'warehouse', 'total')),
  year        INT NOT NULL,
  month       INT NOT NULL CHECK (month BETWEEN 1 AND 12),
  value       NUMERIC NOT NULL,
  base_year   TEXT NOT NULL,          -- '2020'
  source      TEXT,
  source_url  TEXT,
  fetched_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- series_code에 basis가 이미 들어 있으므로 계열+시점이면 유일하다.
  UNIQUE (series_code, year, month)
);

CREATE INDEX IF NOT EXISTS jp_price_indices_lookup_idx
  ON jp_price_indices (category, basis, year DESC, month DESC);

ALTER TABLE jp_price_indices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon read jp_price_indices" ON jp_price_indices;
CREATE POLICY "anon read jp_price_indices"
  ON jp_price_indices FOR SELECT TO anon USING (true);

DROP POLICY IF EXISTS "service write jp_price_indices" ON jp_price_indices;
CREATE POLICY "service write jp_price_indices"
  ON jp_price_indices FOR ALL TO service_role USING (true);
