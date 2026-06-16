-- 026: 일일 환율 (USD/KRW, USD/CNY)
-- kita_air_rates(USD) → KRW 환산 표기, 운임 대시보드 원화 환산용
CREATE TABLE IF NOT EXISTS exchange_rates (
  id         UUID    DEFAULT gen_random_uuid() PRIMARY KEY,
  rate_date  DATE    NOT NULL,
  usd_krw    NUMERIC(12, 2) NOT NULL,
  usd_cny    NUMERIC(12, 4),
  source     TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (rate_date)
);

ALTER TABLE exchange_rates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_read"    ON exchange_rates FOR SELECT TO anon         USING (true);
CREATE POLICY "service_write" ON exchange_rates FOR ALL   TO service_role USING (true);
