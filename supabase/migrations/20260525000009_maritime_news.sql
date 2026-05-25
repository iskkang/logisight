-- supabase/migrations/20260525000009_maritime_news.sql
-- 글로벌 해운 뉴스 (RSS 수집, 30일 롤링)

create table if not exists maritime_news (
  id           bigserial primary key,
  title        text not null,
  url          text not null unique,
  source       text not null,
  published_at timestamptz,
  summary      text,                   -- description 앞 300자 (HTML 태그 제거)
  lang         text not null default 'en',
  fetched_at   timestamptz not null default now()
);

create index on maritime_news (published_at desc);

alter table maritime_news enable row level security;

create policy "anon_read" on maritime_news
  for select to anon using (true);
