-- 016: 운임공표제 운임 테이블 (한국발 컨테이너 운임공표제 KMI 데이터)
CREATE TABLE IF NOT EXISTS freight_rates (
  id                  UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  carrier             TEXT,
  pol_code            TEXT NOT NULL,
  pol_name            TEXT,
  pod_code            TEXT NOT NULL,
  pod_name            TEXT,
  container_type      TEXT NOT NULL,
  rate_usd            NUMERIC,
  currency            TEXT DEFAULT 'USD',
  weekly_change_pct   NUMERIC,
  is_featured         BOOLEAN DEFAULT false,
  is_partner_rate     BOOLEAN DEFAULT false,
  transit_days        INTEGER,
  valid_from          DATE,
  valid_until         DATE,
  data_source         TEXT NOT NULL DEFAULT 'KMI',
  source_updated_at   TIMESTAMPTZ,
  display_order       INTEGER,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  ann_no              TEXT,           -- 운임공표제 공시번호
  imxprt_se           TEXT            -- 수출입 구분
);

ALTER TABLE freight_rates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_read" ON freight_rates FOR SELECT TO anon USING (true);
CREATE POLICY "service_write" ON freight_rates FOR ALL TO service_role USING (true);
