-- supabase/migrations/20260523000003_cadi_od_lanes.sql
-- User decision B: replace route-type lanes (TCR/TSR/…) with OD-pair lanes.
-- No production data in shipment_legs/delay_index_weekly yet → safe to swap seed.

-- ── 1. Remove route-type placeholders ────────────────────────────────────────
-- FK references exist but no rows point to these IDs yet.
DELETE FROM lanes WHERE id IN ('TCR', 'TSR', 'TITR', 'TMR', 'TMGR');

-- ── 2. Insert OD-pair lanes ───────────────────────────────────────────────────
-- KR-* = Korea origin | CN-* = China origin
INSERT INTO lanes (id, name_en, name_ko, name_ru, name_zh, transit_min, transit_max, border_points) VALUES
  -- Kashi pattern (카시 루트) ─────────────────────────────────────────────────
  ('KR-ANDIJAN',      'Korea → Andijan (Kashi)',       'KR-안디잔 (카시)',     'КР→Андижан (Кашгар)',      '韩国→安集延(喀什)',      30, 40,
   ARRAY['Qingdao','Kashi','Osh','KG-UZ border']),
  ('KR-OSH',          'Korea → Osh (Kashi)',           'KR-오쉬 (카시)',       'КР→Ош (Кашгар)',           '韩国→奥什(喀什)',         32, 42,
   ARRAY['Qingdao','Kashi','Osh']),
  ('KR-BISHKEK',      'Korea → Bishkek (Kashi)',       'KR-비슈켁 (카시)',     'КР→Бишкек (Кашгар)',       '韩国→比什凯克(喀什)',     28, 38,
   ARRAY['Qingdao','Kashi','KZ border']),
  ('KR-CHUKURSAY',    'Korea → Chukursay (Kashi)',     'KR-추쿠르사이 (카시)', 'КР→Чукурсай (Кашгар)',     '韩国→朱库尔赛(喀什)',     33, 45,
   ARRAY['Qingdao','Kashi','Osh','UZ border']),

  -- Khorgos pattern (코르고스 루트) ────────────────────────────────────────────
  ('KR-ALMATY',       'Korea → Almaty (Khorgos)',      'KR-알마티 (코르고스)', 'КР→Алматы (Хоргос)',       '韩国→阿拉木图(霍尔果斯)', 25, 35,
   ARRAY['Qingdao','Xian','Khorgos','Almaty']),

  -- Northern pattern (Dostyk→Russia→Brest→Małaszewicze) ───────────────────────
  ('KR-MALASZEWICZE', 'Korea → Małaszewicze (Northern)','KR-말라셰비체 (북방)', 'КР→Малашевиче (Северный)', '韩国→马拉舍维奇(北方)',   40, 55,
   ARRAY['Qingdao','Xian','Dostyk','Kartaly','Brest','Małaszewicze']),

  -- China-origin lanes ─────────────────────────────────────────────────────────
  ('CN-ANDIJAN',      'China → Andijan (Kashi)',       'CN-안디잔 (카시)',     'КН→Андижан (Кашгар)',      '中国→安集延(喀什)',       18, 28,
   ARRAY['Kashi','Osh','KG-UZ border']),
  ('CN-BISHKEK',      'China → Bishkek (Kashi)',       'CN-비슈켁 (카시)',     'КН→Бишкек (Кашгар)',       '中国→比什凯克(喀什)',     15, 25,
   ARRAY['Kashi','KZ border'])
ON CONFLICT (id) DO UPDATE SET
  name_en      = EXCLUDED.name_en,
  name_ko      = EXCLUDED.name_ko,
  name_ru      = EXCLUDED.name_ru,
  name_zh      = EXCLUDED.name_zh,
  transit_min  = EXCLUDED.transit_min,
  transit_max  = EXCLUDED.transit_max,
  border_points = EXCLUDED.border_points;

-- ── 3. Expand route_pattern CHECK to include 'northern' ──────────────────────
-- shipment_legs (added in v2)
ALTER TABLE shipment_legs
  DROP CONSTRAINT IF EXISTS shipment_legs_route_pattern_check;
ALTER TABLE shipment_legs
  ADD CONSTRAINT shipment_legs_route_pattern_check
  CHECK (route_pattern IN ('kashi', 'khorgos', 'northern', 'tsr'));

-- ── 4. Add transport_mode column to shipment_legs (meta field) ────────────────
ALTER TABLE shipment_legs
  ADD COLUMN IF NOT EXISTS transport_mode TEXT,   -- Rail | SEA+RAIL+TRUCK | TRUCK
  ADD COLUMN IF NOT EXISTS load_type      TEXT,   -- FCL | LCL | ...
  ADD COLUMN IF NOT EXISTS current_loc    TEXT,   -- current_location from live API
  ADD COLUMN IF NOT EXISTS signal         TEXT;   -- red | yellow | green (ETA status)
