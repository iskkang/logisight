-- 023: trade_statistics에 10일 단위 잠정치 컬럼 추가
-- stat_type: 'provisional_exp' | 'provisional_imp' 행에서만 사용

ALTER TABLE trade_statistics
  ADD COLUMN IF NOT EXISTS priod_dt  TEXT,   -- '01~10' | '01~20' | '01~말일'
  ADD COLUMN IF NOT EXISTS direction TEXT;   -- 'exp' | 'imp'

-- 10일 잠정치 조회용 인덱스
CREATE INDEX IF NOT EXISTS idx_trade_stats_provisional
  ON trade_statistics (stat_type, period, priod_dt)
  WHERE stat_type IN ('provisional_exp', 'provisional_imp');
