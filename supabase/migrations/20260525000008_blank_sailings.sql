-- supabase/migrations/20260525000008_blank_sailings.sql
-- 블랭크 세일링 (지역별 주간) + 정시성 proxy

create table if not exists blank_sailings (
  id           bigserial primary key,
  week_start   date not null,
  region       text not null,          -- 'East Asia' | 'Mediterranean' | ...
  blanked_teu  double precision,
  planned_teu  double precision,
  blank_pct    double precision,       -- blanked/planned * 100 (null 허용)
  source       text not null,
  fetched_at   timestamptz not null default now(),
  unique (week_start, region)
);

-- Schedule Reliability 요약 (blank_pct 역산 proxy)
create table if not exists schedule_reliability (
  week_start   date primary key,
  on_time_pct  double precision,       -- 100 - AVG(blank_pct). proxy 임을 UI에 표시
  data_type    text not null default 'proxy',  -- 'proxy' | 'direct'
  source       text not null,
  fetched_at   timestamptz not null default now()
);

alter table blank_sailings      enable row level security;
alter table schedule_reliability enable row level security;

create policy "anon_read" on blank_sailings
  for select to anon using (true);

create policy "anon_read" on schedule_reliability
  for select to anon using (true);
