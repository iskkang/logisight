-- port_throughput 국가 구분 컬럼
-- 일본판 사이트를 분리 운영하므로, 프런트가 port_code 접두어를 문자열로 자르지 않고
-- country로 조회를 나눌 수 있게 한다. 기존 행은 0건이라 백필 대상이 없다.
--
-- 재실행 안전: 컬럼·인덱스 모두 IF NOT EXISTS.
ALTER TABLE port_throughput ADD COLUMN IF NOT EXISTS country TEXT;

CREATE INDEX IF NOT EXISTS port_throughput_country_period_idx
  ON port_throughput (country, year DESC, month DESC);
