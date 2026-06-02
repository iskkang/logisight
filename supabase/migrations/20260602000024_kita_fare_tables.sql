-- 024: KITA 참고운임 해상·항공 운임 테이블
-- 출처: https://www.kita.net/shippers/logisticsFare/
-- 해상: kita_sea_rates (노선별 TEU/FEU USD), kita_sea_indices (RADIS·권역 지수)
-- 항공: kita_air_rates (노선별 kg100/300/500 USD), kita_air_indices (권역 지수 KRW)
-- upsert 키: (origin, dest, year_mon) / year_mon

-- ── 해상 노선 운임 ────────────────────────────────────────────────────────────
CREATE TABLE kita_sea_rates (
  id         BIGSERIAL PRIMARY KEY,
  origin     TEXT NOT NULL,            -- '부산'
  dest       TEXT NOT NULL,            -- '롱비치'
  region     TEXT NOT NULL,            -- '북미'
  year_mon   TEXT NOT NULL,            -- 'YYYYMM'
  teu        NUMERIC(10,2),            -- USD/TEU
  feu        NUMERIC(10,2),            -- USD/FEU
  teu_chg    NUMERIC(10,2),            -- MoM 증감 (USD)
  feu_chg    NUMERIC(10,2),
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT kita_sea_rates_uq UNIQUE (origin, dest, year_mon)
);

ALTER TABLE kita_sea_rates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_read"    ON kita_sea_rates FOR SELECT TO anon         USING (true);
CREATE POLICY "service_write" ON kita_sea_rates FOR ALL   TO service_role USING (true);

CREATE INDEX idx_kita_sea_rates_route ON kita_sea_rates (origin, dest, year_mon DESC);
CREATE INDEX idx_kita_sea_rates_region ON kita_sea_rates (region, year_mon DESC);

-- ── 해상 권역 지수 (RADIS·북미·유럽·아시아) ──────────────────────────────────
CREATE TABLE kita_sea_indices (
  id         BIGSERIAL PRIMARY KEY,
  year_mon   TEXT NOT NULL UNIQUE,     -- 'YYYYMM'
  radis      NUMERIC(10,2),            -- RADIS 종합 지수
  na_index   NUMERIC(10,2),            -- 북미 지수
  eu_index   NUMERIC(10,2),            -- 유럽 지수
  asia_index NUMERIC(10,2),            -- 아시아 지수
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE kita_sea_indices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_read"    ON kita_sea_indices FOR SELECT TO anon         USING (true);
CREATE POLICY "service_write" ON kita_sea_indices FOR ALL   TO service_role USING (true);

-- ── 항공 노선 운임 ────────────────────────────────────────────────────────────
CREATE TABLE kita_air_rates (
  id         BIGSERIAL PRIMARY KEY,
  origin     TEXT NOT NULL,            -- '인천'
  dest       TEXT NOT NULL,            -- 'Chicago'
  region     TEXT NOT NULL,            -- '북미'
  year_mon   TEXT NOT NULL,            -- 'YYYYMM'
  kg100      NUMERIC(12,2),            -- USD, +100kg 요율
  kg300      NUMERIC(12,2),            -- USD, +300kg 요율
  kg500      NUMERIC(12,2),            -- USD, +500kg 요율
  chg100     NUMERIC(10,2),            -- MoM 증감
  chg300     NUMERIC(10,2),
  chg500     NUMERIC(10,2),
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT kita_air_rates_uq UNIQUE (origin, dest, year_mon)
);

ALTER TABLE kita_air_rates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_read"    ON kita_air_rates FOR SELECT TO anon         USING (true);
CREATE POLICY "service_write" ON kita_air_rates FOR ALL   TO service_role USING (true);

CREATE INDEX idx_kita_air_rates_route  ON kita_air_rates (origin, dest, year_mon DESC);
CREATE INDEX idx_kita_air_rates_region ON kita_air_rates (region, year_mon DESC);

-- ── 항공 권역 지수 (북미·유럽·아시아·중국, 단위 KRW) ─────────────────────────
CREATE TABLE kita_air_indices (
  id         BIGSERIAL PRIMARY KEY,
  year_mon   TEXT NOT NULL UNIQUE,     -- 'YYYYMM'
  na_index   NUMERIC(12,2),            -- 북미 지수 (KRW)
  eu_index   NUMERIC(12,2),            -- 유럽 지수 (KRW)
  asia_index NUMERIC(12,2),            -- 아시아 지수 (KRW)
  cn_index   NUMERIC(12,2),            -- 중국 지수 (KRW)
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE kita_air_indices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_read"    ON kita_air_indices FOR SELECT TO anon         USING (true);
CREATE POLICY "service_write" ON kita_air_indices FOR ALL   TO service_role USING (true);
