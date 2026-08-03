-- port_throughput 속보(速報) 대응 컬럼
-- 일본 港湾統計은 확보(確報)가 약 12개월 지연이라 뉴스로 쓸 수 없다. 주요 6항 속보가
-- 약 3개월 지연으로 따로 나오므로 같은 테이블에 담되, 확정 여부를 구분한다.
--
-- 실행 순서: 속보 수집기를 먼저, 확보 수집기를 나중에 돌린다. 같은 달을 둘 다
-- 다루면 확보가 덮어써야 맞다(is_preliminary가 false로 내려간다).
--
-- 재실행 안전: 모든 컬럼·인덱스 IF NOT EXISTS.
ALTER TABLE port_throughput ADD COLUMN IF NOT EXISTS export_teu     BIGINT;
ALTER TABLE port_throughput ADD COLUMN IF NOT EXISTS import_teu     BIGINT;
-- 원자료는 전년동월비를 지수(100.128)로 주지만, 여기에는 증감률(+0.128)로 저장한다.
ALTER TABLE port_throughput ADD COLUMN IF NOT EXISTS yoy_pct        NUMERIC;
ALTER TABLE port_throughput ADD COLUMN IF NOT EXISTS is_preliminary BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS port_throughput_preliminary_idx
  ON port_throughput (country, is_preliminary, year DESC, month DESC);
