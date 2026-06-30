-- trade_summary — 산업별/무역 페이지 사전집계(pre-aggregate) 테이블.
-- 프론트가 방문마다 trade_statistics(stat_type='item', 약 1만+행/월)를 전수 페이지네이션해
-- 클라이언트에서 챕터·총계를 집계하던 13초 병목을 제거한다. 파이프라인이 월 1회 미리 집계해 적재하고,
-- 프론트는 이 작은 요약만 읽는다(F7). 차원: 기준월 × (HS 챕터 | 국가 | 전체). 측정: 금액·물량·수지.
--
-- 원칙: 결측은 0/더미로 채우지 않고 NULL로 둔다(결측 ≠ 0). row_count로 집계 투명성 보존.

create table if not exists public.trade_summary (
  period         text not null,                 -- 기준월 (원본 표기 그대로, 예: '2026-05')
  dim_type       text not null,                 -- 'hs_chapter' | 'country' | 'total'
  dim_key        text not null,                 -- HS2('84') | ISO2('CN') | 'ALL'
  dim_label      text,                          -- '기계류' | '중국' | '전체'
  export_usd     numeric,                       -- 결측 시 NULL
  import_usd     numeric,
  export_weight  numeric,
  import_weight  numeric,
  trade_balance  numeric,                       -- export_usd - import_usd (둘 다 NULL이면 NULL)
  row_count      integer,                       -- 집계에 들어간 원본 item/country 행 수
  updated_at     timestamptz not null default now(),
  primary key (period, dim_type, dim_key)
);

alter table public.trade_summary enable row level security;

-- 공개 읽기 전용(프론트 anon). 쓰기는 service_role(파이프라인)만.
create policy "trade_summary read" on public.trade_summary
  for select using (true);

create index if not exists trade_summary_dim_period_idx
  on public.trade_summary (dim_type, period);
