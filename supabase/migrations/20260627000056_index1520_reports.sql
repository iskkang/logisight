-- index1520(UTLC ERA) Analytics 격주 리포트("Eurasian logistics market update") 본문 저장.
-- collectors/index1520_reports.ts 가 service_role로 upsert. monthly-report 철도 섹션 + (선택) 프론트 활용.

create table if not exists index1520_reports (
  id bigint generated always as identity primary key,
  url text not null unique,
  title text,
  report_date date,
  issue_no integer,
  summary text,
  content text,
  source text not null default 'index1520',
  source_url text,
  fetched_at timestamptz not null default now()
);

-- 프론트 anon 노출 가능성 대비 public read (service_role 쓰기는 RLS 우회).
alter table public.index1520_reports enable row level security;
drop policy if exists index1520_reports_public_read on public.index1520_reports;
create policy index1520_reports_public_read on public.index1520_reports for select using (true);
