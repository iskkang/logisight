-- supabase/migrations/20260523000001_cadi_schema.sql
-- CADI: Central Asia Delay Intelligence schema
-- Milestones: ORIGIN_DEP, SEA_TS_ARR, RAIL_DEP_CN, KASHI_ARR, KASHI_BONDED,
--             TRUCK_DEP, XIAN_HUB, CN_BORDER, KG_UZ_BORDER, DEST_ARR

-- ── Enums ─────────────────────────────────────────────────────────────────────
CREATE TYPE milestone_code AS ENUM (
  'ORIGIN_DEP',
  'SEA_TS_ARR',
  'RAIL_DEP_CN',
  'KASHI_ARR',
  'KASHI_BONDED',
  'TRUCK_DEP',
  'XIAN_HUB',
  'CN_BORDER',
  'KG_UZ_BORDER',
  'DEST_ARR'
);

CREATE TYPE data_quality_level AS ENUM ('confirmed', 'provisional', 'indicative');

CREATE TYPE disruption_severity AS ENUM ('high', 'medium', 'low');

-- ── lanes ──────────────────────────────────────────────────────────────────────
CREATE TABLE lanes (
  id           TEXT PRIMARY KEY,   -- 'TCR' | 'TSR' | 'TITR' | 'TMR' | 'TMGR'
  name_en      TEXT NOT NULL,
  name_zh      TEXT,
  name_ru      TEXT,
  name_ko      TEXT,
  transit_min  INTEGER,            -- planned transit days (min)
  transit_max  INTEGER,            -- planned transit days (max)
  border_points TEXT[],            -- key border crossings
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ── shipment_legs (service-role only — anon RLS blocks all) ───────────────────
CREATE TABLE shipment_legs (
  id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  lane_id          TEXT NOT NULL REFERENCES lanes(id),
  shipment_ref     TEXT NOT NULL,     -- anonymized reference (ETL strips real B/L)
  week_iso         TEXT NOT NULL,     -- 'YYYY-WNN' e.g. '2026-W20'
  milestone        milestone_code NOT NULL,
  planned_at       TIMESTAMPTZ,
  actual_at        TIMESTAMPTZ,
  delay_hours      NUMERIC,           -- actual - planned (hours); negative = early
  flag             TEXT,              -- e.g. 'date_parse_error', 'actual_missing'
  raw_source_file  TEXT,              -- source xlsx filename only
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (shipment_ref, milestone)
);

-- ── delay_index_weekly (anon read — aggregated only) ─────────────────────────
CREATE TABLE delay_index_weekly (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  lane_id         TEXT NOT NULL REFERENCES lanes(id),
  week_iso        TEXT NOT NULL,
  milestone       milestone_code NOT NULL,
  median_delay_h  NUMERIC,            -- median delay hours
  p90_delay_h     NUMERIC,            -- 90th percentile delay hours
  on_time_rate    NUMERIC,            -- fraction with delay_hours <= 0
  sample_count    INTEGER NOT NULL,
  data_quality    data_quality_level NOT NULL,
  gap_vs_premium  NUMERIC,            -- optional: gap vs premium lane median (hours)
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (lane_id, week_iso, milestone)
);

-- ── disruption_events (anon read) ─────────────────────────────────────────────
CREATE TABLE disruption_events (
  id             UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  lane_id        TEXT REFERENCES lanes(id),   -- NULL = affects all lanes
  event_type     TEXT NOT NULL,               -- 'BORDER_CLOSURE' | 'CUSTOMS_DELAY' | 'POLICY_CHANGE' | 'CAPACITY'
  title_en       TEXT NOT NULL,
  title_ru       TEXT,
  title_zh       TEXT,
  title_ko       TEXT,
  description_en TEXT,
  description_ru TEXT,
  started_at     TIMESTAMPTZ,
  resolved_at    TIMESTAMPTZ,                 -- NULL = still ongoing
  severity       disruption_severity NOT NULL DEFAULT 'medium',
  source_url     TEXT,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

-- ── RLS Policies ──────────────────────────────────────────────────────────────
ALTER TABLE lanes ENABLE ROW LEVEL SECURITY;
ALTER TABLE shipment_legs ENABLE ROW LEVEL SECURITY;
ALTER TABLE delay_index_weekly ENABLE ROW LEVEL SECURITY;
ALTER TABLE disruption_events ENABLE ROW LEVEL SECURITY;

-- lanes: anyone can read
CREATE POLICY "lanes_public_read" ON lanes
  FOR SELECT TO anon, authenticated USING (true);

-- shipment_legs: NO anon policy → anon gets 0 rows (raw data protection)

-- delay_index_weekly: aggregated data is public
CREATE POLICY "delay_index_public_read" ON delay_index_weekly
  FOR SELECT TO anon, authenticated USING (true);

-- disruption_events: public alerts
CREATE POLICY "disruption_events_public_read" ON disruption_events
  FOR SELECT TO anon, authenticated USING (true);

-- ── Seed: Lane Definitions ────────────────────────────────────────────────────
INSERT INTO lanes (id, name_en, name_zh, name_ru, name_ko, transit_min, transit_max, border_points) VALUES
  ('TCR',  'Trans-China Railway',              '中欧班列',        'Транскитайская ж/д',     'TCR 중국 횡단',  23, 30, ARRAY['Erenhot', 'Khorgos', 'Dostyk']),
  ('TSR',  'Trans-Siberian Railway',           '西伯利亚铁路',    'Транссибирская ж/д',     'TSR 시베리아',   20, 27, ARRAY['Zabaikalsk', 'Vladivostok']),
  ('TITR', 'Trans-Caspian (Middle Corridor)',  '中间走廊',        'Средний коридор',        'TITR 중간 회랑', 38, 45, ARRAY['Aktau', 'Baku', 'Poti']),
  ('TMR',  'Trans-Manchurian Railway',         '满洲里铁路',      'Трансманьчжурская ж/д',  'TMR 만주',       25, 35, ARRAY['Manzhouli', 'Zabaykalsk']),
  ('TMGR', 'Trans-Mongolian Railway',          '蒙古铁路',        'Трансмонгольская ж/д',   'TMGR 몽골',      28, 38, ARRAY['Erlian', 'Ulaanbaatar'])
ON CONFLICT (id) DO NOTHING;
