-- 열람 기록. 무료 기간이 끝날 때 "누구에게 결제를 요청할지" 판단할 근거.
--
-- GA4를 쓰지 않는 이유: 무료판은 사용자 단위로 "이 사람이 리포트를 몇 번 열었나"를
-- 꺼내기 어렵다. 우리는 이미 로그인과 DB가 있으므로 직접 남긴다.
-- 총 트래픽·유입 경로는 별도로 GA4를 붙이면 되고, 이 표는 전환 판단만 담당한다.
--
-- 남기는 것은 경로와 누구인지까지다. IP·UA는 남기지 않는다 — 전환 판단에 필요 없고,
-- 없는 편이 개인정보 취급 부담이 낮다.
--
-- DO NOT APPLY automatically — Supabase SQL Editor에서 수동 적용.

create table if not exists public.site_views (
  id          bigserial primary key,
  site        text        not null check (site in ('jp', 'ko')),
  path        text        not null,
  -- 로그인 사용자. 비로그인은 null이고 anon_id로만 묶인다.
  user_id     uuid        references auth.users(id) on delete set null,
  -- 브라우저 단위 임의 식별자(localStorage). 개인을 특정하지 않는다.
  anon_id     text        not null,
  referrer    text,
  created_at  timestamptz not null default now()
);

comment on table public.site_views is
  '열람 기록. 무료 기간 종료 시 결제 요청 대상 판단용. IP·UA는 남기지 않는다.';

-- 조회는 "이 사용자가 이 경로를 몇 번" 형태다.
create index if not exists site_views_user_idx on public.site_views (user_id, created_at desc)
  where user_id is not null;
create index if not exists site_views_site_path_idx on public.site_views (site, path, created_at desc);
create index if not exists site_views_anon_idx on public.site_views (anon_id, created_at desc);

alter table public.site_views enable row level security;

-- 쓰기만 허용한다. 남의 열람 기록을 읽을 수 있으면 안 된다.
-- 집계는 service_role로 한다.
drop policy if exists site_views_insert_anon on public.site_views;
create policy site_views_insert_anon on public.site_views
  for insert to anon, authenticated
  with check (true);
