-- 내륙 물류 거점(intermodal/rail hub) 자산 추가 — event→물류 영향(climate:event) 게이트 대상.
-- assets.type CHECK가 port/choke로 한정돼 있으면 완화(rail은 이미 v2에서 들어와 제약이 사라졌을 수 있음 → if exists).
alter table public.assets drop constraint if exists assets_type_check;
alter table public.assets add constraint assets_type_check
  check (type in ('port','choke','rail','inland'));

insert into public.assets (id,name,type,lon,lat,freeze_prone) values
  ('chicago',     'Chicago (intermodal)',      'inland', -87.63,  41.88, false),
  ('memphis',     'Memphis (intermodal)',      'inland', -90.05,  35.15, false),
  ('dallas',      'Dallas–Fort Worth (inland)','inland', -96.80,  32.78, false),
  ('kansas_city', 'Kansas City (intermodal)',  'inland', -94.58,  39.10, false),
  ('atlanta',     'Atlanta (inland)',          'inland', -84.39,  33.75, false),
  ('newark_inland','NY/NJ Inland (intermodal)','inland', -74.17,  40.73, false),
  ('duisburg',    'Duisburg (inland)',         'inland',   6.76,  51.43, false),
  ('milan_inland','Milan (inland terminal)',   'inland',   9.19,  45.46, false),
  ('madrid_inland','Madrid (inland terminal)', 'inland',  -3.70,  40.42, false),
  ('zhengzhou',   'Zhengzhou (inland hub)',    'inland', 113.62,  34.75, false),
  ('chongqing',   'Chongqing (inland hub)',    'inland', 106.55,  29.56, false),
  ('delhi_inland','Delhi (inland terminal)',   'inland',  77.10,  28.70, false)
on conflict (id) do update set
  name = excluded.name, type = excluded.type, lon = excluded.lon, lat = excluded.lat, freeze_prone = excluded.freeze_prone;
