-- (b) 이벤트 × passages 교차판정 결과 저장.
-- 태풍은 예보트랙(점열) × passage.influence_radius_km 교차 → 걸린 passage의 모든 route/asset로 전파.
-- events.track: HKO ForecastInformation 폴리라인([[lon,lat],...], 현재 분석점 선두). event-ingest가 적재.
-- asset_risk 점수 가산·forecast(c)·프론트는 범위 아님 — 본 마이그레이션은 '무엇이 무엇에 걸리나' 저장까지.
-- DO NOT APPLY automatically — run manually after review (db push 수동). 040(passages) 이후 적용.

-- cyclone 예보트랙(점열). 비-cyclone(점 이벤트)은 null → 단일좌표(lon/lat) 폴백.
alter table public.events add column if not exists track jsonb;

-- 교차판정 결과: (이벤트, passage)별 최소거리 1행.
create table if not exists public.event_passage_hits (
  event_id      text not null,
  passage_id    text not null references public.passages(id) on delete cascade,
  min_dist_km   double precision not null,           -- 트랙 점열 중 최소 대권거리
  hit_point_idx integer,                              -- 최근접 점의 트랙 인덱스(0=현재 분석점)
  nearest_at    timestamptz,                          -- 그 점의 예보시각(HKO 예보점은 시각 미제공 → null)
  created_at    timestamptz not null default now(),
  primary key (event_id, passage_id)                  -- 같은 passage 여러 점 걸려도 1행(중복 PK 금지)
);
create index if not exists event_passage_hits_passage_idx on public.event_passage_hits (passage_id);

alter table public.event_passage_hits enable row level security;
create policy "read event_passage_hits" on public.event_passage_hits for select using (true);

-- 조회 편의 뷰: hit → 그 passage를 지나는 모든 route로 펼침(route 단위 영향 목록).
-- 한 route가 여러 passage로 걸리면 via_passage_id로 구분되는 복수 행.
create or replace view public.event_route_impacts
with (security_invoker = true) as
select h.event_id,
       rp.route_id,
       h.passage_id as via_passage_id,
       h.min_dist_km
from public.event_passage_hits h
join public.route_passages rp on rp.passage_id = h.passage_id;

grant select on public.event_route_impacts to anon, authenticated;
