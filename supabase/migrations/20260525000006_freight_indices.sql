-- supabase/migrations/20260525000006_freight_indices.sql
-- 운임 지수 (BDI · WCI · FBX · SCFI · KCCI) 주간 스냅샷

create table if not exists freight_indices (
  id          bigserial primary key,
  index_code  text not null,           -- 'BDI' | 'WCI' | 'FBX' | 'SCFI' | 'KCCI'
  value       double precision,        -- null 허용 (수집 실패 시)
  week_date   date not null,           -- 해당 주 월요일
  change_pct  double precision,        -- 전주 대비 변화율 (null 허용)
  source      text not null,
  source_url  text,
  fetched_at  timestamptz not null default now(),
  unique (index_code, week_date)
);

alter table freight_indices enable row level security;

create policy "anon_read" on freight_indices
  for select to anon using (true);
