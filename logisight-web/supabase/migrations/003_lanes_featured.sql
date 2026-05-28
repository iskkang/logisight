-- ============================================================================
-- Migration 003: lanes 테이블에 is_featured, display_order 추가
-- EurasiaBridge 위젯에 표시할 featured 노선 3개 seed
-- ============================================================================

ALTER TABLE lanes
  ADD COLUMN IF NOT EXISTS is_featured   BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS display_order INT DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_lanes_featured ON lanes(is_featured, display_order)
  WHERE is_featured = TRUE;

-- EurasiaBridge 홈 위젯용 featured 노선 3개
UPDATE lanes SET is_featured = TRUE, display_order = 1 WHERE id = 'KR-ANDIJAN';
UPDATE lanes SET is_featured = TRUE, display_order = 2 WHERE id = 'KR-ALMATY';
UPDATE lanes SET is_featured = TRUE, display_order = 3 WHERE id = 'KR-MALASZEWICZE';

-- RLS: 기존 lanes 정책이 없으면 추가
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'lanes'
      AND policyname = 'public_read_lanes'
  ) THEN
    EXECUTE 'CREATE POLICY "public_read_lanes" ON lanes FOR SELECT USING (true)';
  END IF;
END $$;
