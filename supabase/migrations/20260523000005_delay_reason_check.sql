-- supabase/migrations/20260523000005_delay_reason_check.sql
-- Add CHECK constraint on delay_reason per CADI spec (policy|customs|truck_swap|schedule|weather|other).
-- Safe: column is NULL for all current rows (ETL does not set delay_reason yet).

ALTER TABLE shipment_legs
  ADD CONSTRAINT shipment_legs_delay_reason_check
  CHECK (delay_reason IS NULL OR delay_reason IN ('policy','customs','truck_swap','schedule','weather','other'));

-- Also constrain data_source (renamed from source in spec, tracing|field_report|customer)
ALTER TABLE shipment_legs
  ADD CONSTRAINT shipment_legs_data_source_check
  CHECK (data_source IS NULL OR data_source IN ('tracing','field_report','customer'));
