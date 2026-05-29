-- Migration 010: freight_rates unique constraint
-- ann_no = data.go.kr 공표번호 (행 고유 식별자)
-- UNIQUE on (ann_no, container_type) → upsert 기준

ALTER TABLE freight_rates ADD COLUMN IF NOT EXISTS ann_no TEXT;

ALTER TABLE freight_rates
  ADD CONSTRAINT freight_rates_ann_uniq UNIQUE (ann_no, container_type);
