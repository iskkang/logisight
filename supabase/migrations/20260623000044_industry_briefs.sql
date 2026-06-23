-- 044: industry_briefs — 산업 페이지 "종합 판단" 브리핑 캐시 + HS 챕터 집계 RPC
-- trade_briefs(043)의 산업판 트윈. 쓰기: supabase/functions/industry-brief-generate
-- (service_role, RLS 우회). 읽기: 공개(anon·RLS) — 프론트(industries)가 직접 read.

create table if not exists public.industry_briefs (
  period       text primary key,          -- 'YYYY.MM' (관세청 기준월)
  verdict      text not null,             -- 1문장 결론(두괄식)
  detail       text not null,             -- 2~3문장 근거
  input_hash   text not null,             -- 입력 지표 해시(중복 생성 방지)
  model        text not null,
  generated_at timestamptz not null default now()
);

alter table public.industry_briefs enable row level security;

create policy "industry_briefs read" on public.industry_briefs
  for select using (true);

-- HS 챕터(2자리) 집계 RPC.
-- trade_statistics(stat_type='item', 10자리 hs_code)를 챕터로 SUM해 ≤99행만 반환한다.
-- 전수 fetch(수천 행, PostgREST 1000행 상한) 회피 + 전국 합계를 챕터 합으로 일관 도출
-- (country 수집기가 'ALL' 합계행을 적재하지 않으므로).
create or replace function public.industry_chapter_totals(p_period text)
returns table (
  chapter       text,
  export_usd    numeric,
  import_usd    numeric,
  trade_balance numeric
)
language sql
stable
as $$
  select left(hs_code, 2)   as chapter,
         sum(export_usd)     as export_usd,
         sum(import_usd)     as import_usd,
         sum(trade_balance)  as trade_balance
  from trade_statistics
  where stat_type = 'item'
    and period = p_period
    and hs_code is not null
  group by left(hs_code, 2);
$$;

grant execute on function public.industry_chapter_totals(text) to service_role;
