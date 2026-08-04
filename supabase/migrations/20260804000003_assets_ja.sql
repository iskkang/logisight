-- 기상 리스크 지구본 — 일본판 대응.
--   (1) 일본 주요 6항을 자산으로 추가한다. 지금까지 일본 항만이 하나도 없어
--       jpn.logisight.net의 기상 페이지가 일본 독자에게 아무 의미가 없었다.
--   (2) name_ja 컬럼을 두고 전 자산·전 항로의 일본어명을 채운다.
--       name은 한국어 단일 컬럼이라, 이대로면 일본 사이트 지도에 '상하이'가 찍힌다.
--       리포트의 lang, 뉴스의 category_ja와 같은 방식이다.
--
-- 일본 6항은 월간 리포트가 다루는 港湾統計 主要6港과 같다(generators/jp-report PORT_NAMES).
-- 리포트와 지도가 다른 항만을 말하면 독자가 대조할 수 없다.
--
-- 좌표는 컨테이너 부두 앞바다에 잡았다. 육지에 찍으면 marine-api가 파고를 돌려주지 않아
-- 해상 리스크가 영구 결측이 된다.
--
-- 한국 사이트에도 이 6항이 함께 나타난다. assets는 두 사이트가 공유하는 테이블이고,
-- 부산·상하이가 있는 지도에 일본 주요항이 없는 편이 오히려 빈 구멍이다.
--
-- DO NOT APPLY automatically — Supabase SQL Editor에서 수동 적용.

alter table public.assets add column if not exists name_ja text;
alter table public.routes add column if not exists name_ja text;

comment on column public.assets.name_ja is '일본판 표시명. 없으면 name으로 대체한다.';
comment on column public.routes.name_ja is '일본판 표시명. 없으면 name으로 대체한다.';

-- ── 일본 주요 6항 ─────────────────────────────────────────────────────
insert into public.assets (id,name,name_ja,type,lon,lat,freeze_prone) values
 ('tokyo',    '도쿄',   '東京港',   'port', 139.79, 35.61, false),
 ('yokohama', '요코하마', '横浜港',   'port', 139.67, 35.44, false),
 ('nagoya',   '나고야',  '名古屋港', 'port', 136.87, 35.03, false),
 ('kobe',     '고베',   '神戸港',   'port', 135.22, 34.66, false),
 ('osaka',    '오사카',  '大阪港',   'port', 135.42, 34.63, false),
 ('kawasaki', '가와사키', '川崎港',   'port', 139.78, 35.50, false)
on conflict (id) do update set
  name=excluded.name, name_ja=excluded.name_ja, type=excluded.type,
  lon=excluded.lon, lat=excluded.lat, freeze_prone=excluded.freeze_prone;

-- ── 기존 자산의 일본어명 ───────────────────────────────────────────────
-- 항만·해협은 일본에서 통용되는 표기를 쓴다(ロッテルダム, スエズ運河).
update public.assets set name_ja = v.ja from (values
  -- 항만
  ('shanghai','上海港'), ('singapore','シンガポール港'), ('busan','釜山港'),
  ('ningbo','寧波港'), ('shenzhen','深圳港'), ('hongkong','香港港'),
  ('rotterdam','ロッテルダム港'), ('hamburg','ハンブルク港'), ('antwerp','アントワープ港'),
  ('losangeles','ロサンゼルス港'), ('newyork','ニューヨーク港'), ('jebelali','ジェベルアリ港'),
  ('colombo','コロンボ港'), ('piraeus','ピレウス港'), ('santos','サントス港'),
  ('vancouver','バンクーバー港'),
  ('vladivostok','ウラジオストク港'), ('vostochny','ボストチヌイ港'),
  ('stpetersburg','サンクトペテルブルク港'), ('primorsk','プリモルスク港'),
  ('helsinki','ヘルシンキ港'), ('kotka','コトカ港'), ('riga','リガ港'),
  ('arkhangelsk','アルハンゲリスク港'),
  -- 해협·운하
  ('suez','スエズ運河'), ('panama','パナマ運河'), ('malacca','マラッカ海峡'),
  ('hormuz','ホルムズ海峡'), ('babelmandeb','バブ・エル・マンデブ海峡'),
  ('bosphorus','ボスポラス海峡'), ('gibraltar','ジブラルタル海峡'),
  ('goodhope','喜望峰'), ('taiwan','台湾海峡'), ('dover','ドーバー海峡'),
  -- 철도 거점
  ('xian','西安'), ('khorgos','ホルゴス'), ('dostyk','ドスティク'),
  ('kashi','カシュガル'), ('osh','オシ'), ('almaty','アルマトイ'),
  ('tashkent','タシケント'), ('zabaikalsk','ザバイカリスク'), ('brest','ブレスト'),
  -- 내륙 거점
  ('atlanta','アトランタ(内陸)'), ('chicago','シカゴ(インターモーダル)'),
  ('chongqing','重慶(内陸ハブ)'), ('dallas','ダラス・フォートワース(内陸)'),
  ('delhi_inland','デリー(内陸ターミナル)'), ('duisburg','デュイスブルク(内陸)'),
  ('kansas_city','カンザスシティ(インターモーダル)'), ('madrid_inland','マドリード(内陸ターミナル)'),
  ('memphis','メンフィス(インターモーダル)'), ('milan_inland','ミラノ(内陸ターミナル)'),
  ('newark_inland','ニューヨーク/ニュージャージー内陸(インターモーダル)'),
  ('zhengzhou','鄭州(内陸ハブ)')
) as v(id, ja) where assets.id = v.id;

-- ── 항로 ──────────────────────────────────────────────────────────────
update public.routes set name_ja = v.ja from (values
  ('r1','アジア–欧州'),
  ('r2','環太平洋(TPM)'),
  ('r3','アジア–北米東岸'),
  ('r4','大西洋航路'),
  ('r5','中東–アジア(エネルギー)'),
  ('r6','アジア–欧州(喜望峰迂回)')
) as v(id, ja) where routes.id = v.id;
