-- 기상 리스크 지구본 v2 — 자산 추가 (철도 내륙 9 + 결빙 취약 항만 8 = 17개).
-- 멱등(on conflict do update). 무르만스크는 부동항이라 제외.
-- DO NOT APPLY automatically — run manually after review (...036_v2_schema.sql 이후).

-- 철도 내륙 지점 (TCR/CIS 회랑)
insert into public.assets (id,name,type,lon,lat,freeze_prone) values
 ('xian','시안','rail',108.9,34.3,false),
 ('khorgos','호르고스','rail',80.4,44.2,false),
 ('dostyk','도스틱','rail',82.5,45.25,false),
 ('kashi','카스(카슈가르)','rail',76.0,39.5,false),
 ('osh','오시','rail',72.8,40.5,false),
 ('almaty','알마티','rail',76.9,43.2,false),
 ('tashkent','타슈켄트','rail',69.2,41.3,false),
 ('zabaikalsk','자바이칼스크','rail',117.3,49.6,false),
 ('brest','브레스트','rail',23.7,52.1,false)
on conflict (id) do update set name=excluded.name,type=excluded.type,lon=excluded.lon,lat=excluded.lat,freeze_prone=excluded.freeze_prone;

-- 결빙 취약 항만 (극동 + 발트/서러시아 + 백해)
insert into public.assets (id,name,type,lon,lat,freeze_prone) values
 ('vladivostok','블라디보스토크','port',131.9,43.1,true),
 ('vostochny','보스토치니','port',132.7,42.9,true),
 ('stpetersburg','상트페테르부르크','port',30.3,59.9,true),
 ('primorsk','프리모르스크','port',28.6,60.4,true),
 ('helsinki','헬싱키','port',25.0,60.2,true),
 ('kotka','코트카','port',26.9,60.5,true),
 ('riga','리가','port',24.1,57.0,true),
 ('arkhangelsk','아르한겔스크','port',40.5,64.5,true)
on conflict (id) do update set name=excluded.name,type=excluded.type,lon=excluded.lon,lat=excluded.lat,freeze_prone=excluded.freeze_prone;
