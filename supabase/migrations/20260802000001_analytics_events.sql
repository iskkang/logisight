-- 20260802000001_analytics_events.sql
-- 057: 사이트 계측 이벤트 — 공개 오픈 전 퍼널 기준선 확보.
--
-- 왜 지금인가: 파이프라인은 산출물을 만들지만 "누가 읽었나"를 닫는 루프가 없다.
--   오픈 후에 붙이면 초기 유입 데이터가 영구 유실된다. 오픈 전에 심는다.
--
-- 개인정보 원칙 (독립 미디어에서 신뢰는 자산이다):
--   · 쿠키·IP·이메일 등 개인식별자 저장 금지. referrer는 호스트만, 위치는 국가 코드까지만.
--   · session_id는 sessionStorage 난수 — 탭을 닫으면 소멸하는 비영속 값(교차 사이트 추적 불가).
--   · 쓰기는 track Edge Function(service_role)만. anon 직접 INSERT 금지(위조·스팸 차단).
--   · 원장(raw)은 비공개. 공개 지표가 필요하면 집계 뷰만 노출한다.
--
-- 보존: 원장은 무한 증가한다. 집계 뷰가 안정화되면 90일 이전 원장 삭제 배치를 별도로 붙일 것.

create table if not exists public.analytics_events (
  id            bigserial   primary key,
  event         text        not null,               -- track 함수의 allowlist로 검증된 값만 들어온다
  path          text,                               -- 사이트 경로(쿼리스트링 제거 후 저장)
  session_id    text,                               -- 비영속 세션 난수. 개인식별자 아님
  referrer_host text,                               -- 유입 출처 호스트만(전체 URL 저장 안 함)
  country       text,                               -- CDN 헤더 기반 2자 국가코드
  props         jsonb       not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);

create index if not exists analytics_events_event_time_idx on public.analytics_events (event, created_at desc);
create index if not exists analytics_events_time_idx       on public.analytics_events (created_at desc);
create index if not exists analytics_events_session_idx    on public.analytics_events (session_id, created_at);

alter table public.analytics_events enable row level security;
-- 원장은 service_role 전용. anon/authenticated 정책 없음 = 읽기·쓰기 모두 차단.
drop policy if exists "service_only" on public.analytics_events;
create policy "service_only" on public.analytics_events
  for all to service_role using (true) with check (true);

-- ── 집계 뷰 ────────────────────────────────────────────────────────────────
-- security_invoker: 하위 테이블 RLS를 호출자 기준으로 평가(20260801000001과 동일 원칙).
-- 따라서 이 뷰들도 service_role만 읽을 수 있다 — 내부 KPI용.

-- 일자별 퍼널: 도달 → 열람 → 완독 → 구독. 오픈 전후 추세를 한 줄로 본다.
create or replace view public.v_kpi_daily
with (security_invoker = on) as
select
  (created_at at time zone 'Asia/Seoul')::date                                  as day,
  count(distinct session_id)                                                    as sessions,
  count(*) filter (where event = 'page_view')                                   as page_views,
  count(*) filter (where event = 'article_view')                                as article_views,
  count(*) filter (where event = 'article_read'
                    and (props->>'pct') ~ '^[0-9]+$'
                    and (props->>'pct')::int >= 50)                             as reads_50,
  count(*) filter (where event = 'report_view')                                 as report_views,
  count(*) filter (where event = 'report_download')                             as report_downloads,
  count(*) filter (where event = 'track_record_view')                           as track_record_views,
  -- 구독 퍼널 3단: 폼 노출 → 제출 → 완료. 어디서 새는지(CTA 배치인지 폼 자체인지) 가른다.
  count(*) filter (where event = 'subscribe_open')                              as subscribe_opens,
  count(*) filter (where event = 'subscribe_submit')                            as subscribe_submits,
  count(*) filter (where event = 'subscribe_done')                              as subscribe_done
from public.analytics_events
group by 1;

-- 콘텐츠별 성과: 어떤 기사·리포트가 실제로 읽히는가(최근 90일).
-- 기사는 props.slug, 리포트는 props.report_id로 식별한다.
create or replace view public.v_content_engagement
with (security_invoker = on) as
select
  coalesce(props->>'slug', props->>'report_id')                                 as content_key,
  case when props->>'report_id' is not null then 'report' else 'article' end    as content_type,
  count(*) filter (where event in ('article_view', 'report_view'))              as views,
  count(*) filter (where event = 'article_read'
                    and (props->>'pct') ~ '^[0-9]+$'
                    and (props->>'pct')::int >= 50)                             as reads_50,
  count(*) filter (where event = 'report_download')                             as downloads,
  max(created_at)                                                               as last_seen_at
from public.analytics_events
where created_at >= now() - interval '90 days'
  and coalesce(props->>'slug', props->>'report_id') is not null
group by 1, 2;
