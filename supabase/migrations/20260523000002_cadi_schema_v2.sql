-- supabase/migrations/20260523000002_cadi_schema_v2.sql
-- CADI schema v2: add missing fields per spec (부록 A 10절)
-- Additive only — never modifies existing columns or constraints.

-- ── shipment_legs: add route_pattern, destination, B-layer fields ──────────────
ALTER TABLE shipment_legs
  ADD COLUMN IF NOT EXISTS route_pattern TEXT
    CHECK (route_pattern IN ('kashi', 'khorgos', 'tsr')),
  ADD COLUMN IF NOT EXISTS destination   TEXT,           -- 'Andijan','Almaty','Bishkek',...
  ADD COLUMN IF NOT EXISTS delay_days    NUMERIC
    GENERATED ALWAYS AS (delay_hours / 24.0) STORED,   -- derived: hours → days
  ADD COLUMN IF NOT EXISTS delay_reason  TEXT,           -- policy|customs|truck_swap|schedule|weather|other
  ADD COLUMN IF NOT EXISTS reason_note   TEXT,           -- free-text from Remarks column
  ADD COLUMN IF NOT EXISTS data_source   TEXT DEFAULT 'tracing';  -- tracing|field_report|customer

-- ── delay_index_weekly: add route_pattern, derived day columns, methodology_version ──
ALTER TABLE delay_index_weekly
  ADD COLUMN IF NOT EXISTS route_pattern       TEXT,
  ADD COLUMN IF NOT EXISTS destination         TEXT,
  ADD COLUMN IF NOT EXISTS median_delay_d      NUMERIC
    GENERATED ALWAYS AS (median_delay_h / 24.0) STORED,
  ADD COLUMN IF NOT EXISTS p90_delay_d         NUMERIC
    GENERATED ALWAYS AS (p90_delay_h / 24.0) STORED,
  ADD COLUMN IF NOT EXISTS otp_pct             NUMERIC
    GENERATED ALWAYS AS (on_time_rate * 100.0) STORED,
  ADD COLUMN IF NOT EXISTS methodology_version TEXT NOT NULL DEFAULT 'v1.1';

-- ── disruption_events: add B-layer fields missing from v1 ────────────────────
ALTER TABLE disruption_events
  ADD COLUMN IF NOT EXISTS event_date    DATE,           -- canonical event date
  ADD COLUMN IF NOT EXISTS region        TEXT,           -- 'KG-UZ border','Osh','Kashi',...
  ADD COLUMN IF NOT EXISTS category      TEXT,           -- policy|customs|infra|weather|capacity|other
  ADD COLUMN IF NOT EXISTS body_en       TEXT,           -- 현상→원인→배경→전망 (EN)
  ADD COLUMN IF NOT EXISTS impact_days   NUMERIC,        -- estimated delay impact in days
  ADD COLUMN IF NOT EXISTS affected_lanes TEXT[],        -- can affect multiple lanes
  ADD COLUMN IF NOT EXISTS verified_by   TEXT[];         -- {tracing, field_report, customer}

-- Backfill event_date from started_at where available
UPDATE disruption_events
  SET event_date = started_at::DATE
  WHERE event_date IS NULL AND started_at IS NOT NULL;
