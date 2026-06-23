-- 노선을 '통과지점(passages) 시퀀스'로 재구조화 — (a) 데이터 모델·시드·매핑만.
-- 1차 단위 = 통과지점(해역 관문). 노선 = 통과지점들의 순서 있는 목록. 통과지점은 노선 간 공유.
-- 목적: 이벤트(태풍 등)가 '노선'이 아니라 '통과지점'에 걸리고, 그 지점을 지나는 모든 노선에 전파되는 토대.
-- 교차판정(b)·forecast(c)·프론트 표시는 이번 범위 아님 — 본 마이그레이션은 스키마+시드+매핑에 한정.
-- DO NOT APPLY automatically — run manually after review (db push는 사용자 수동).
--
-- 좌표·influence_radius_km는 구간 매칭용 근사값(튜닝 대상). 해협은 협소, 외해 항로점은 광역.
-- 기존 choke 자산과 동일 관문은 asset_id로 '재사용'(중복 노드 금지) — 좌표는 자산과 일치시킴.

create table if not exists public.passages (
  id                  text primary key,                 -- 예: 'taiwan_strait'
  name_ko             text not null,
  name_en             text not null,
  lat                 double precision not null,
  lon                 double precision not null,
  kind                text not null check (kind in ('strait', 'canal', 'cape', 'open_sea_waypoint')),
  influence_radius_km integer not null,                 -- 교차판정(b) 기본 반경 — 근사, 튜닝 대상
  asset_id            text references public.assets(id),-- 기존 choke 자산 재사용(있으면), 외해 점은 null
  updated_at          timestamptz not null default now()
);

create table if not exists public.route_passages (
  route_id   text not null references public.routes(id)    on delete cascade,
  passage_id text not null references public.passages(id)  on delete cascade,
  seq        integer not null,                            -- 노선 내 통과 순서
  primary key (route_id, passage_id),                     -- 한 노선에 같은 통과지점 1회
  unique (route_id, seq)                                   -- 노선 내 seq 유니크
);

create index if not exists route_passages_passage_idx on public.route_passages (passage_id);

alter table public.passages       enable row level security;
alter table public.route_passages enable row level security;
drop policy if exists "read passages"       on public.passages;
drop policy if exists "read route_passages" on public.route_passages;
create policy "read passages"       on public.passages       for select using (true);
create policy "read route_passages" on public.route_passages for select using (true);

-- 신규 노선: 아시아–유럽(희망봉 우회) — 수에즈 노선과 통과지점 다수 공유, 우회 구간만 상이.
insert into public.routes (id, name, waypoints, chokes) values
 ('r6', '아시아–유럽 (희망봉 우회)',
  '["shanghai","taiwan","singapore","malacca","colombo",[70,-12],"goodhope",[0,-33],[-10,5],"gibraltar",[-8,44],"rotterdam"]',
  '{malacca,goodhope,gibraltar}')
on conflict (id) do update set name = excluded.name, waypoints = excluded.waypoints, chokes = excluded.chokes;

-- ── passages 시드 (한국발/동아시아 화물의 공통 관문, 누락 없이) ─────────────────────────
-- asset_id 채워진 행 = 기존 choke 자산과 동일 관문(좌표 일치, 재사용). null = 신규 외해/해협 노드.
insert into public.passages (id, name_ko, name_en, lat, lon, kind, influence_radius_km, asset_id) values
 -- 동아시아 관문
 ('korea_strait',   '대한해협',     'Korea Strait',          34.5, 129.5, 'strait',            150, null),
 ('taiwan_strait',  '대만해협',     'Taiwan Strait',         24.0, 119.5, 'strait',            180, 'taiwan'),
 ('bashi_channel',  '바시해협',     'Bashi Channel',         21.5, 121.0, 'strait',            180, null),
 ('miyako_strait',  '미야코해협',   'Miyako Strait',         24.8, 125.3, 'strait',            150, null),
 -- 동남아
 ('luzon_strait',   '루손해협',     'Luzon Strait',          20.0, 121.0, 'strait',            250, null),
 ('scs_waypoint',   '남중국해 항로점', 'South China Sea Waypoint', 15.0, 114.0, 'open_sea_waypoint', 500, null),
 ('malacca',        '말라카해협',   'Strait of Malacca',      2.5, 100.5, 'strait',            200, 'malacca'),
 ('sunda_lombok',   '순다·롬복해협', 'Sunda/Lombok Strait',   -7.0, 110.0, 'strait',            350, null),
 -- 인도양·중동·아프리카行
 ('indian_ocean_wp','인도양 항로점', 'Indian Ocean Waypoint',  5.0,  75.0, 'open_sea_waypoint', 800, null),
 ('bab_el_mandeb',  '밥엘만데브',   'Bab-el-Mandeb',         12.6,  43.4, 'strait',            120, 'babelmandeb'),
 ('hormuz',         '호르무즈해협', 'Strait of Hormuz',      26.6,  56.3, 'strait',            120, 'hormuz'),
 ('suez',           '수에즈운하',   'Suez Canal',            30.5,  32.35,'canal',             100, 'suez'),
 ('cape_of_good_hope','희망봉',     'Cape of Good Hope',    -34.4,  18.5, 'cape',              250, 'goodhope'),
 ('mozambique_ch',  '모잠비크해협', 'Mozambique Channel',   -18.0,  40.0, 'strait',            350, null),
 -- 유럽行
 ('gibraltar',      '지브롤터해협', 'Strait of Gibraltar',   36.0,  -5.5, 'strait',            120, 'gibraltar'),
 ('dover',          '도버해협',     'Strait of Dover',       51.0,   1.5, 'strait',             80, 'dover'),
 -- 태평양·오세아니아·미주
 ('transpacific_wp','환태평양 항로점','Transpacific Waypoint', 44.0, 180.0, 'open_sea_waypoint', 900, null),
 ('panama',         '파나마운하',   'Panama Canal',           9.1, -79.7, 'canal',             100, 'panama'),
 ('oceania_approach','오세아니아 접근점(토레스)','Oceania Approach (Torres)', -10.5, 142.5, 'open_sea_waypoint', 400, null)
on conflict (id) do update set
  name_ko = excluded.name_ko, name_en = excluded.name_en, lat = excluded.lat, lon = excluded.lon,
  kind = excluded.kind, influence_radius_km = excluded.influence_radius_km, asset_id = excluded.asset_id,
  updated_at = now();

-- ── route ↔ passage 매핑 (순서 보존, 공유 노드 적극 재사용) ───────────────────────────
-- 대만해협(taiwan_strait)은 r1·r3·r5·r6 = 4개 노선 공유(공유 노드 증명).
insert into public.route_passages (route_id, passage_id, seq) values
 -- r1 아시아–유럽(수에즈)
 ('r1','taiwan_strait',1),('r1','scs_waypoint',2),('r1','malacca',3),('r1','indian_ocean_wp',4),
 ('r1','bab_el_mandeb',5),('r1','suez',6),('r1','gibraltar',7),
 -- r2 환태평양(TPM, 부산발 북태평양)
 ('r2','korea_strait',1),('r2','transpacific_wp',2),
 -- r3 아시아–미동안(상하이→파나마)
 ('r3','taiwan_strait',1),('r3','bashi_channel',2),('r3','panama',3),
 -- r4 환대서양(로테르담→뉴욕)
 ('r4','dover',1),
 -- r5 중동–아시아(에너지, 호르무즈→상하이)
 ('r5','hormuz',1),('r5','indian_ocean_wp',2),('r5','malacca',3),('r5','scs_waypoint',4),('r5','taiwan_strait',5),
 -- r6 아시아–유럽(희망봉 우회)
 ('r6','taiwan_strait',1),('r6','scs_waypoint',2),('r6','malacca',3),('r6','indian_ocean_wp',4),
 ('r6','cape_of_good_hope',5),('r6','gibraltar',6)
on conflict (route_id, passage_id) do update set seq = excluded.seq;
