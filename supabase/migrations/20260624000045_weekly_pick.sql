-- supabase/migrations/20260624000045_weekly_pick.sql
-- 이번 주 주목(weekly_pick) — 주간 자동 선정 1건 캐시.
-- 최근 7일 maritime_news(ko)에 점수(언급량·물류 영향도)를 매겨 1건 선정 → 주당 1행 upsert.
-- 소유: 파이프라인(supabase/functions/weekly-pick-select, service_role). 읽기: 공개(Lovable /news 직접 read).

create table if not exists public.weekly_pick (
  week_start   date primary key,          -- 해당 주 월요일(KST). 주당 1행
  week_label   text not null,             -- '06.16 – 06.22'
  article_id   text not null,             -- maritime_news.id (출처 기사)
  headline     text not null,             -- 표시용 비정규화
  category     text,                      -- '해상 · 중동'
  source       text,
  url          text,
  image_url    text,
  view_count   integer,                   -- maritime_news.view_count 도입 시 사용(현재는 항상 null)
  why          text not null,             -- 선정 근거 '최다 조회 · 운임 영향'
  score        numeric not null,
  scored_at    timestamptz not null default now()
);

alter table public.weekly_pick enable row level security;

create policy "weekly_pick read" on public.weekly_pick
  for select using (true);            -- 공개 읽기, 쓰기는 service_role만
