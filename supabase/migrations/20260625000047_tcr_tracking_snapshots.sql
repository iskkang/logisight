-- 047: TCR 추적 스냅샷(append) + first-seen baseline + 노선 지연 산출(tcr_route_health)
-- 기존 tcr_snapshots(011, 익명 집계)·tcr_containers_current(현재상태 덮어쓰기)와는 별개.
-- 문제: collectors/tracing_tcr_current.ts가 현재상태만 덮어쓰기 → baseline 부재 → 지연이 수집일에 리셋.
-- 해결: 일일 스냅샷을 append + 컨테이너별 baseline(최초 관측 eta)을 1회 고정 → 지연 = 최신ETA − baselineETA.
-- DO NOT APPLY automatically — 마이그레이션 적용은 수동(046 이후).

-- 1) append-only 스냅샷 (컨테이너 × 스냅샷일 1행). 기존 tcr_snapshots(집계)와 별개.
create table if not exists tcr_tracking_snapshots (
  id            bigint generated always as identity primary key,
  container_no  text        not null,
  route         text        not null,            -- 여정 식별자(origin → destination, 적재 훅 참조)
  eta           date,                             -- 이 스냅샷의 eta_final
  status_raw    text,
  snapshot_date date        not null,             -- 수집 업무일(KST)
  source        text        not null default 'TCR',
  created_at    timestamptz not null default now(),
  unique (container_no, snapshot_date)            -- 같은 날 재수집은 upsert로 갱신
);
create index if not exists idx_tcrts_route_date on tcr_tracking_snapshots (route, snapshot_date desc);
create index if not exists idx_tcrts_container  on tcr_tracking_snapshots (container_no, snapshot_date desc);

-- 2) baseline = first-seen ETA. insert 후 불변.
create table if not exists tcr_container_baseline (
  container_no  text primary key,
  route         text not null,                    -- 최초 관측 route(고정)
  baseline_eta  date,                             -- 최초 관측 eta_final(고정)
  first_seen    date not null,
  created_at    timestamptz not null default now()
);

-- 3) 산출 결과(프론트 read 전용): 노선 1행
create table if not exists tcr_route_health (
  route             text primary key,
  source            text not null default 'TCR',
  status            text not null,                -- '정상' | '주의' | '지연'
  active_containers int  not null default 0,
  avg_delay_days    numeric,
  max_delay_days    int,
  worst_container   text,
  trend             text not null,                -- '악화'|'안정'|'회복'|'집계중' (현재 프론트 미표시, 향후용)
  trend_points      jsonb not null default '[]',  -- [{d,delay},...] 최근 ~10 스냅샷일(시간순)
  latest_snapshot   date,
  updated_at        timestamptz not null default now()
);

-- RLS: route_health만 공개 read, 내부 2테이블은 service 전용
alter table tcr_tracking_snapshots enable row level security;
alter table tcr_container_baseline enable row level security;
alter table tcr_route_health       enable row level security;
drop policy if exists tcrrh_anon_read on tcr_route_health;
create policy tcrrh_anon_read on tcr_route_health for select to anon using (true);
drop policy if exists tcrrh_service_write on tcr_route_health;
create policy tcrrh_service_write on tcr_route_health for all to service_role using (true) with check (true);
-- snapshots/baseline: anon 정책 없음(service_role만; service_role은 RLS 우회)

-- ── 산출 함수: 그룹 키 = baseline.route(여정 단위 고정 → 세그먼트 라벨 변동에도 집계 불변) ──
-- 임계값: 지연 ≥14일 / 주의 ≥5일 · 추세 ±1일 · 활성 21일 (아래 상수에서 조정)
create or replace function tcr_recompute_route_health() returns void
language plpgsql as $$
begin
  delete from tcr_route_health;  -- 작은 테이블 전체 재빌드(스테일 노선 자동 제거)

  with latest as (   -- 컨테이너별 최신 스냅샷
    select distinct on (s.container_no)
      s.container_no, s.eta as latest_eta, s.snapshot_date
    from tcr_tracking_snapshots s
    order by s.container_no, s.snapshot_date desc
  ),
  active as (        -- 최근 21일 내 관측 + baseline 보유. route는 baseline 기준(고정)
    select b.route, l.container_no, l.latest_eta, l.snapshot_date,
           (l.latest_eta - b.baseline_eta) as delay_days
    from latest l
    join tcr_container_baseline b on b.container_no = l.container_no
    where l.snapshot_date >= (current_date - interval '21 days')
      and l.latest_eta is not null and b.baseline_eta is not null
  ),
  route_agg as (
    select route, count(*) as active_containers,
           round(avg(delay_days)::numeric,1) as avg_delay_days,
           max(delay_days) as max_delay_days, max(snapshot_date) as latest_snapshot
    from active group by route
  ),
  worst as (
    select distinct on (route) route, container_no as worst_container
    from active order by route, delay_days desc
  ),
  daily as (         -- baseline.route × 스냅샷일 평균 지연(추세·스파크라인용)
    select b.route, s.snapshot_date,
           round(avg(s.eta - b.baseline_eta)::numeric,1) as avg_delay
    from tcr_tracking_snapshots s
    join tcr_container_baseline b on b.container_no = s.container_no
    where s.eta is not null and b.baseline_eta is not null
    group by b.route, s.snapshot_date
  ),
  pts as (
    select route,
           jsonb_agg(jsonb_build_object('d', snapshot_date, 'delay', avg_delay) order by snapshot_date) as trend_points,
           count(*) as n_days
    from (select route, snapshot_date, avg_delay,
                 row_number() over (partition by route order by snapshot_date desc) as rn
          from daily) d
    where rn <= 10 group by route
  ),
  trend as (
    select p.route, p.n_days,
      (p.trend_points -> (jsonb_array_length(p.trend_points)-1) ->> 'delay')::numeric as latest_delay,
      (p.trend_points -> 0 ->> 'delay')::numeric as ref_delay
    from pts p
  )
  insert into tcr_route_health
    (route, source, status, active_containers, avg_delay_days, max_delay_days, worst_container, trend, trend_points, latest_snapshot, updated_at)
  select ra.route, 'TCR',
    case when ra.max_delay_days >= 14 then '지연'
         when ra.max_delay_days >= 5  then '주의' else '정상' end,
    ra.active_containers, ra.avg_delay_days, ra.max_delay_days, w.worst_container,
    case when t.n_days < 2 or t.latest_delay is null or t.ref_delay is null then '집계중'
         when t.latest_delay > t.ref_delay + 1 then '악화'
         when t.latest_delay < t.ref_delay - 1 then '회복' else '안정' end,
    coalesce(p.trend_points, '[]'::jsonb), ra.latest_snapshot, now()
  from route_agg ra
  left join worst w on w.route = ra.route
  left join pts   p on p.route = ra.route
  left join trend t on t.route = ra.route;
end $$;
