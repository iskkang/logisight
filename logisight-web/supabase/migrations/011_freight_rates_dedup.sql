-- Migration 011: freight_rates dedup key — 4-column unique index
-- Replaces 010's 2-column constraint with (ann_no, imxprt_se, pod_code, container_type)

ALTER TABLE freight_rates ADD COLUMN IF NOT EXISTS ann_no     TEXT;
ALTER TABLE freight_rates ADD COLUMN IF NOT EXISTS imxprt_se  TEXT;

-- Drop previous constraint from migration 010 (if applied)
ALTER TABLE freight_rates DROP CONSTRAINT IF EXISTS freight_rates_ann_uniq;
DROP INDEX IF EXISTS freight_rates_natural_key;

CREATE UNIQUE INDEX freight_rates_uniq ON freight_rates(
  COALESCE(ann_no,    ''),
  COALESCE(imxprt_se, ''),
  pod_code,
  container_type
);
