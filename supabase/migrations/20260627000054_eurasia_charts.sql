-- eurasia_charts: index1520(ERAI) 차트 스냅샷 저장(jsonb).
-- 파이프라인 cron이 index1520 공개 JSON을 통째 적재 → 프론트(Vercel SSR)는 이 테이블만 읽는다(백엔드 직접 호출 금지).
create table if not exists public.eurasia_charts (
  key        text primary key,          -- 'index_quotes' | 'geo'
  payload    jsonb not null,            -- 엔드포인트 응답 원본(전체 이력)
  source     text,                      -- 'ERAI'
  source_url text,                      -- 출처 표기용 원문 링크
  updated_at timestamptz not null default now()
);

-- 프론트는 anon 키로 읽으므로 public SELECT 허용(쓰기는 service_role로 RLS 우회).
alter table public.eurasia_charts enable row level security;
drop policy if exists eurasia_charts_public_read on public.eurasia_charts;
create policy eurasia_charts_public_read on public.eurasia_charts for select using (true);
