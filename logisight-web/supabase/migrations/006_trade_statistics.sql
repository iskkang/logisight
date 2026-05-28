-- Migration 006: trade_statistics
-- 관세청 수출입실적 API 데이터를 저장하는 유연한 스키마.
-- 필드명은 API 가이드 도착 후 어댑터(scripts/fetch-trade-stats.ts)에서 매핑.

CREATE TABLE IF NOT EXISTS trade_statistics (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  period        TEXT        NOT NULL,          -- 'YYYYMM' 기준연월
  stat_type     TEXT        NOT NULL,          -- 'item' | 'country' | 'region'
  hs_code       TEXT,                          -- 품목 HS코드 (item type)
  hs_name       TEXT,
  country_code  TEXT,                          -- 국가코드 (country type)
  country_name  TEXT,
  export_usd    NUMERIC,                       -- 수출금액 USD
  export_weight NUMERIC,                       -- 수출중량 kg
  import_usd    NUMERIC,                       -- 수입금액 USD
  import_weight NUMERIC,                       -- 수입중량 kg
  trade_balance NUMERIC,                       -- 무역수지 (export - import)
  data_source   TEXT        DEFAULT '관세청 수출입무역통계',
  fetched_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (period, stat_type, hs_code, country_code)
);

CREATE INDEX IF NOT EXISTS idx_trade_period
  ON trade_statistics (period DESC, stat_type);

CREATE INDEX IF NOT EXISTS idx_trade_hs
  ON trade_statistics (hs_code, period DESC);

ALTER TABLE trade_statistics ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "public_read_trade" ON trade_statistics;
CREATE POLICY "public_read_trade"
  ON trade_statistics FOR SELECT USING (true);
