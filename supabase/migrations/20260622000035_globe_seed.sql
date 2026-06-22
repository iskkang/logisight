-- 기상 리스크 지구본 — 시드 데이터 (assets 26개 + routes 5개).
-- 멱등(on conflict do update) — 재실행 안전.
-- DO NOT APPLY automatically — run manually after review (20260622000034_globe_risk.sql 이후).

insert into public.assets (id,name,type,lon,lat) values
 ('shanghai','상하이','port',121.5,31.2),
 ('singapore','싱가포르','port',103.8,1.3),
 ('busan','부산','port',129.0,35.1),
 ('ningbo','닝보','port',121.6,29.9),
 ('shenzhen','선전','port',113.9,22.5),
 ('hongkong','홍콩','port',114.2,22.3),
 ('rotterdam','로테르담','port',4.1,51.9),
 ('hamburg','함부르크','port',9.9,53.5),
 ('antwerp','안트베르펜','port',4.4,51.3),
 ('losangeles','로스앤젤레스','port',-118.2,33.7),
 ('newyork','뉴욕','port',-74.0,40.6),
 ('jebelali','두바이','port',55.0,25.0),
 ('colombo','콜롬보','port',79.8,6.9),
 ('piraeus','피레아스','port',23.6,37.9),
 ('santos','산투스','port',-46.3,-23.9),
 ('vancouver','밴쿠버','port',-123.1,49.3),
 ('suez','수에즈 운하','choke',32.35,30.5),
 ('panama','파나마 운하','choke',-79.7,9.1),
 ('malacca','말라카 해협','choke',100.5,2.5),
 ('hormuz','호르무즈 해협','choke',56.3,26.6),
 ('babelmandeb','바브엘만데브','choke',43.4,12.6),
 ('bosphorus','보스포루스','choke',29.1,41.1),
 ('gibraltar','지브롤터','choke',-5.5,36.0),
 ('goodhope','희망봉','choke',18.5,-34.4),
 ('taiwan','대만 해협','choke',119.5,24.0),
 ('dover','도버 해협','choke',1.5,51.0)
on conflict (id) do update set name=excluded.name, type=excluded.type, lon=excluded.lon, lat=excluded.lat;

insert into public.routes (id,name,waypoints,chokes) values
 ('r1','아시아–유럽','["shanghai","singapore","malacca","colombo",[60,8],"babelmandeb","suez",[29,33],"piraeus",[10,37],"gibraltar",[-8,44],"rotterdam"]','{malacca,babelmandeb,suez,gibraltar}'),
 ('r2','환태평양 (TPM)','["busan",[150,40],[178,46],[-160,46],[-128,40],"losangeles"]','{}'),
 ('r3','아시아–미동안','["shanghai","taiwan",[140,20],[175,16],[-150,12],"panama",[-75,18],"newyork"]','{taiwan,panama}'),
 ('r4','환대서양','["rotterdam","dover",[-6,48],[-28,50],[-52,44],"newyork"]','{dover}'),
 ('r5','중동–아시아 (에너지)','["hormuz",[60,22],"colombo","malacca","singapore","shanghai"]','{hormuz,malacca}')
on conflict (id) do update set name=excluded.name, waypoints=excluded.waypoints, chokes=excluded.chokes;
