-- Index1520 라우트 지도용 좌표 시드. 근사 좌표(MVP) — 구조만 정확하면 추후 갱신 용이.
-- 재실행 안전: on conflict (id) do update 로 좌표/메타 갱신.
-- station 타입 id 는 transit-service 의 실제 station id (지도 라인이 이 id로 매칭되어 그려짐).
-- city/terminal 타입은 추후 활용용(현재 transit-service O-D 는 국경 환적역만 제공).

insert into public.index1520_locations (id, name, normalized_name, location_type, country_code, latitude, longitude) values
  -- transit-service 실제 station id (국경 환적역) — 지도 렌더 대상
  ('707701', 'Altynkol (EXP)',                'ALTYNKOL',       'station',  'KZ', 44.2100, 80.4000),
  ('707805', 'Altynkol (Eksp. Perev. Avto)',  'ALTYNKOL',       'station',  'KZ', 44.2100, 80.4000),
  ('708507', 'Dostyk (EXP.)',                 'DOSTYK',         'station',  'KZ', 45.2600, 82.4900),
  ('710102', 'Dostyk (Eksp. Perev. Avto)',    'DOSTYK',         'station',  'KZ', 45.2600, 82.4900),
  ('130609', 'Brest-Center (EXP.)',           'BREST-CENTER',   'station',  'BY', 52.1000, 23.6900),
  ('130505', 'Brest-Severny (EXP.)',          'BREST-SEVERNY',  'station',  'BY', 52.1300, 23.6600),
  -- 주요 국경/터미널/도시 (추후 활용)
  ('DOSTYK',       'Dostyk',        'DOSTYK',        'terminal', 'KZ', 45.2600, 82.4900),
  ('ALTYNKOL',     'Altynkol',      'ALTYNKOL',      'terminal', 'KZ', 44.2100, 80.4000),
  ('ALASHANKOU',   'Alashankou',    'ALASHANKOU',    'terminal', 'CN', 45.1700, 82.5700),
  ('KHORGOS',      'Khorgos',       'KHORGOS',       'terminal', 'CN', 44.2100, 80.4200),
  ('MALASZEWICZE', 'Malaszewicze',  'MALASZEWICZE',  'terminal', 'PL', 52.0300, 23.4600),
  ('DUISBURG',     'Duisburg',      'DUISBURG',      'city',     'DE', 51.4344, 6.7623),
  ('HAMBURG',      'Hamburg',       'HAMBURG',       'city',     'DE', 53.5511, 9.9937),
  ('WARSAW',       'Warsaw',        'WARSAW',        'city',     'PL', 52.2297, 21.0122),
  ('LODZ',         'Lodz',          'LODZ',          'city',     'PL', 51.7592, 19.4560),
  ('CHENGDU',      'Chengdu',       'CHENGDU',       'city',     'CN', 30.5728, 104.0668),
  ('CHONGQING',    'Chongqing',     'CHONGQING',     'city',     'CN', 29.5630, 106.5516),
  ('XIAN',         'Xi''an',        'XIAN',          'city',     'CN', 34.3416, 108.9398),
  ('ZHENGZHOU',    'Zhengzhou',     'ZHENGZHOU',     'city',     'CN', 34.7466, 113.6254),
  ('WUHAN',        'Wuhan',         'WUHAN',         'city',     'CN', 30.5928, 114.3055),
  ('YIWU',         'Yiwu',          'YIWU',          'city',     'CN', 29.3060, 120.0750),
  ('SHANGHAI',     'Shanghai',      'SHANGHAI',      'city',     'CN', 31.2304, 121.4737)
on conflict (id) do update set
  name = excluded.name,
  normalized_name = excluded.normalized_name,
  location_type = excluded.location_type,
  country_code = excluded.country_code,
  latitude = excluded.latitude,
  longitude = excluded.longitude,
  updated_at = now();

-- 국가 중심 좌표 — route view=list 의 국가 O-D(departure_id/destination_id = ISO-2)용. 국가 간 코리도어 라인 렌더.
insert into public.index1520_locations (id, name, normalized_name, location_type, country_code, latitude, longitude) values
  ('CN', 'China',          'CHINA',          'country', 'CN', 35.0000, 105.0000),
  ('BE', 'Belgium',        'BELGIUM',        'country', 'BE', 50.6400,   4.6700),
  ('DE', 'Germany',        'GERMANY',        'country', 'DE', 51.1600,  10.4500),
  ('NL', 'Netherlands',    'NETHERLANDS',    'country', 'NL', 52.1300,   5.2900),
  ('PL', 'Poland',         'POLAND',         'country', 'PL', 51.9200,  19.1500),
  ('FR', 'France',         'FRANCE',         'country', 'FR', 46.6000,   2.2000),
  ('IT', 'Italy',          'ITALY',          'country', 'IT', 41.9000,  12.6000),
  ('ES', 'Spain',          'SPAIN',          'country', 'ES', 40.0000,  -3.7000),
  ('GB', 'United Kingdom', 'UNITED KINGDOM', 'country', 'GB', 54.0000,  -2.0000),
  ('CZ', 'Czechia',        'CZECHIA',        'country', 'CZ', 49.8000,  15.5000),
  ('AT', 'Austria',        'AUSTRIA',        'country', 'AT', 47.6000,  14.1000),
  ('HU', 'Hungary',        'HUNGARY',        'country', 'HU', 47.2000,  19.5000),
  ('SK', 'Slovakia',       'SLOVAKIA',       'country', 'SK', 48.7000,  19.7000),
  ('LT', 'Lithuania',      'LITHUANIA',      'country', 'LT', 55.2000,  23.9000),
  ('BY', 'Belarus',        'BELARUS',        'country', 'BY', 53.7000,  27.9000),
  ('RU', 'Russia',         'RUSSIA',         'country', 'RU', 55.7500,  37.6200),
  ('KZ', 'Kazakhstan',     'KAZAKHSTAN',     'country', 'KZ', 48.0000,  67.0000),
  ('FI', 'Finland',        'FINLAND',        'country', 'FI', 62.0000,  26.0000),
  ('SE', 'Sweden',         'SWEDEN',         'country', 'SE', 62.0000,  15.0000),
  ('TR', 'Turkey',         'TURKEY',         'country', 'TR', 39.0000,  35.0000)
on conflict (id) do update set
  name = excluded.name,
  normalized_name = excluded.normalized_name,
  location_type = excluded.location_type,
  country_code = excluded.country_code,
  latitude = excluded.latitude,
  longitude = excluded.longitude,
  updated_at = now();
