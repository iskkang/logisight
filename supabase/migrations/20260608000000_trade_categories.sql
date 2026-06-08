-- 030: 관세청 추가 무역통계 4종 (대륙별·품목별·품목별국가별·신성질별)
-- collectors/trade_categories.ts 가 trade_statistics 테이블의 기존 컬럼을 재사용한다.
-- (provisional_exp/imp 가 컬럼을 재사용하는 선례와 동일 — 신규 컬럼 추가 없음)
--
-- stat_type 별 컬럼 매핑:
--   'continent'    : country_code=대륙코드, country_name=대륙명, export_usd/import_usd/trade_balance
--                    (대륙별 API는 중량 미제공 → export_weight/import_weight = NULL)
--   'item'         : hs_code=10자리 HS, hs_name=품목명, country_* = NULL
--   'item_country' : hs_code=10자리 HS, country_code/name 동시 보유
--   'newnature'    : hs_code=신성질 분류코드(8자리), hs_name=분류명, country_code/name 보유
--
-- 신규 stat_type 조회 성능용 인덱스 (보고서·검증 쿼리 패턴: stat_type+period)
CREATE INDEX IF NOT EXISTS idx_trade_stats_category
  ON trade_statistics (stat_type, period)
  WHERE stat_type IN ('continent', 'item', 'item_country', 'newnature');
