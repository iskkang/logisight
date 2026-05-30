-- 017: 한국 무역통계 (관세청 + 해양수산부 공공데이터)
CREATE TABLE IF NOT EXISTS trade_statistics (
  id             UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  period         TEXT NOT NULL,         -- 'YYYY-MM' or 'YYYY'
  stat_type      TEXT NOT NULL,         -- 'item' | 'country' | 'port'
  hs_code        TEXT,
  hs_name        TEXT,
  country_code   TEXT,
  country_name   TEXT,
  export_usd     NUMERIC,
  export_weight  NUMERIC,
  import_usd     NUMERIC,
  import_weight  NUMERIC,
  trade_balance  NUMERIC,
  data_source    TEXT,
  fetched_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (period, stat_type, hs_code, country_code)
);

ALTER TABLE trade_statistics ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_read" ON trade_statistics FOR SELECT TO anon USING (true);
CREATE POLICY "service_write" ON trade_statistics FOR ALL TO service_role USING (true);
