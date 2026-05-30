-- 022: 데이터 수집 상태 추적 (파이프라인 모니터링용)
CREATE TABLE IF NOT EXISTS data_updates (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  dataset      TEXT NOT NULL,
  record_count INTEGER,
  status       TEXT DEFAULT 'ok'
    CHECK (status IN ('ok', 'error', 'partial')),
  notes        TEXT,
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE data_updates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_read" ON data_updates FOR SELECT TO anon USING (true);
CREATE POLICY "service_write" ON data_updates FOR ALL TO service_role USING (true);
