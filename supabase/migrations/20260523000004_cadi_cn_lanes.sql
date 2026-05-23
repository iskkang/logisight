-- supabase/migrations/20260523000004_cadi_cn_lanes.sql
-- Add missing China-origin OD-pair lanes discovered from live API data.
-- CN-CHUKURSAY, CN-OSH, CN-ALMATY appear in the 180-container dataset.

INSERT INTO lanes (id, name_en, name_ko, name_ru, name_zh, transit_min, transit_max, border_points) VALUES
  ('CN-OSH',         'China → Osh (Kashi)',       'CN-오쉬 (카시)',       'КН→Ош (Кашгар)',       '中国→奥什(喀什)',         12, 22,
   ARRAY['Kashi','Osh']),
  ('CN-CHUKURSAY',   'China → Chukursay (Kashi)', 'CN-추쿠르사이 (카시)', 'КН→Чукурсай (Кашгар)', '中国→朱库尔赛(喀什)',     14, 24,
   ARRAY['Kashi','Osh','UZ border']),
  ('CN-ALMATY',      'China → Almaty (Khorgos)',  'CN-알마티 (코르고스)', 'КН→Алматы (Хоргос)',   '中国→阿拉木图(霍尔果斯)', 10, 18,
   ARRAY['Xian','Khorgos','Almaty'])
ON CONFLICT (id) DO UPDATE SET
  name_en       = EXCLUDED.name_en,
  name_ko       = EXCLUDED.name_ko,
  name_ru       = EXCLUDED.name_ru,
  name_zh       = EXCLUDED.name_zh,
  transit_min   = EXCLUDED.transit_min,
  transit_max   = EXCLUDED.transit_max,
  border_points = EXCLUDED.border_points;
