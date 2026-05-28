-- 011: TCR 라이브 일별 스냅샷 (익명 집계 추이 추적용)
-- customer_list / container_no 저장 금지 — 집계 수치만 보관

create table if not exists tcr_snapshots (
  id             bigserial   primary key,
  snapshot_date  date        not null,
  total          int         not null default 0,
  in_transit     int         not null default 0,
  arrived        int         not null default 0,
  alert_count    int         not null default 0,
  by_destination jsonb,
  by_segment     jsonb,
  created_at     timestamptz not null default now()
);

create unique index if not exists tcr_snapshots_date_uniq
  on tcr_snapshots (snapshot_date);

alter table tcr_snapshots enable row level security;

-- anon 읽기 허용 (집계치만 저장되므로 공개 안전)
create policy "public read tcr_snapshots"
  on tcr_snapshots for select using (true);

-- service_role 쓰기 (스크립트/워크플로우)
create policy "service role write tcr_snapshots"
  on tcr_snapshots for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');
