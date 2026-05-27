-- supabase/migrations/20260527000010_port_throughput.sql
CREATE TABLE IF NOT EXISTS port_throughput (
  id           BIGSERIAL PRIMARY KEY,
  port_code    TEXT NOT NULL,
  year         INT  NOT NULL,
  month        INT  NOT NULL,
  teu          BIGINT,
  source       TEXT,
  source_url   TEXT,
  fetched_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(port_code, year, month)
);

ALTER TABLE port_throughput ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon read port_throughput"
  ON port_throughput FOR SELECT TO anon USING (true);

CREATE POLICY "service write port_throughput"
  ON port_throughput FOR ALL TO service_role USING (true);
