-- Migration 012: replace COALESCE-based index with plain-column UNIQUE
-- onConflict in Supabase JS requires exact column name match (no expressions)

DROP INDEX IF EXISTS freight_rates_uniq;
DROP INDEX IF EXISTS freight_rates_natural_key;

CREATE UNIQUE INDEX freight_rates_uniq
  ON freight_rates (ann_no, imxprt_se, pod_code, container_type);
