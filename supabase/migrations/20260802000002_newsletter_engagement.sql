-- 20260802000002_newsletter_engagement.sql
-- 058: 뉴스레터 발송·반응 기록.
--
-- 공백: send-newsletter.js가 Resend로 발송만 하고 아무 기록도 남기지 않는다.
--   누구에게 몇 통 나갔는지, 도달했는지, 열었는지 전부 조회 불가 상태다.
--   뉴스레터가 제품의 중심인데 성과 지표가 0인 셈 — 오픈 전에 메운다.
--
-- 개인정보: 이벤트 원장에 이메일 원문을 저장하지 않는다.
--   Resend 웹훅이 주는 이메일은 resend-webhook 함수에서 subscriber_id(uuid)로 해석한 뒤 버린다.
--   newsletter_subscribers 자체가 service_role 전용이므로 결합해야만 사람이 식별된다.

-- 캠페인 1회 발송 = 1행.
create table if not exists public.newsletter_sends (
  id          uuid        primary key default gen_random_uuid(),
  campaign_id text        not null unique,          -- 'daily-2026-08-02' | 'weekly-2026-W31'
  kind        text        not null check (kind in ('daily', 'weekly', 'report')),
  edition     text        not null default 'kr',    -- 일본판 확장 대비(kr | jp)
  subject     text        not null,
  recipients  integer     not null default 0,       -- 발송 시도 수신자 수
  failed      integer     not null default 0,       -- Resend 호출 실패 건수(도달 실패와 별개)
  sent_at     timestamptz not null default now(),
  meta        jsonb       not null default '{}'::jsonb
);

create index if not exists newsletter_sends_sent_idx on public.newsletter_sends (sent_at desc);

-- Resend 웹훅 이벤트 원장(append-only). 같은 메일의 재오픈도 그대로 쌓고, 집계에서 dedup 한다.
create table if not exists public.newsletter_events (
  id              bigserial   primary key,
  campaign_id     text,                             -- 발송 시 Resend tag로 심어 되돌려받는다
  resend_email_id text,                             -- 메일 1통 식별자(오픈·클릭 dedup 키)
  subscriber_id   uuid        references public.newsletter_subscribers(id) on delete set null,
  event           text        not null check (event in
                    ('sent', 'delivered', 'opened', 'clicked', 'bounced', 'complained', 'unsubscribed')),
  url             text,                             -- clicked일 때 클릭 대상
  created_at      timestamptz not null default now()
);

create index if not exists newsletter_events_campaign_idx   on public.newsletter_events (campaign_id, event);
create index if not exists newsletter_events_subscriber_idx on public.newsletter_events (subscriber_id, created_at desc);
create index if not exists newsletter_events_email_idx      on public.newsletter_events (resend_email_id);

alter table public.newsletter_sends  enable row level security;
alter table public.newsletter_events enable row level security;

-- 둘 다 service_role 전용(개인정보 결합 가능 데이터). anon 정책 없음 = 전면 차단.
drop policy if exists "service_only" on public.newsletter_sends;
create policy "service_only" on public.newsletter_sends
  for all to service_role using (true) with check (true);

drop policy if exists "service_only" on public.newsletter_events;
create policy "service_only" on public.newsletter_events
  for all to service_role using (true) with check (true);

-- ── 집계 뷰 ────────────────────────────────────────────────────────────────

-- 캠페인별 성과. 오픈·클릭은 메일 단위 dedup(재오픈 중복 제거) 후 센다.
create or replace view public.v_newsletter_campaign_stats
with (security_invoker = on) as
select
  s.campaign_id,
  s.kind,
  s.edition,
  s.subject,
  s.sent_at,
  s.recipients,
  count(distinct e.resend_email_id) filter (where e.event = 'delivered')  as delivered,
  count(distinct e.resend_email_id) filter (where e.event = 'opened')     as unique_opens,
  count(distinct e.resend_email_id) filter (where e.event = 'clicked')    as unique_clicks,
  count(distinct e.resend_email_id) filter (where e.event = 'bounced')    as bounced,
  count(distinct e.resend_email_id) filter (where e.event = 'complained') as complained,
  -- 오픈율 분모는 도달(delivered). 도달 기록이 아직 없으면 NULL — 0%로 위장하지 않는다.
  round(
    100.0 * count(distinct e.resend_email_id) filter (where e.event = 'opened')
    / nullif(count(distinct e.resend_email_id) filter (where e.event = 'delivered'), 0)
  , 1) as open_rate_pct,
  round(
    100.0 * count(distinct e.resend_email_id) filter (where e.event = 'clicked')
    / nullif(count(distinct e.resend_email_id) filter (where e.event = 'delivered'), 0)
  , 1) as click_rate_pct
from public.newsletter_sends s
left join public.newsletter_events e on e.campaign_id = s.campaign_id
group by s.campaign_id, s.kind, s.edition, s.subject, s.sent_at, s.recipients;

-- 구독자별 반응도 — "잠재고객" 판별의 1차 재료.
-- 영업 리드 스코어링은 이 뷰 위에서 별도로 만들 것(여기서는 원시 반응만 집계).
create or replace view public.v_subscriber_engagement
with (security_invoker = on) as
select
  sub.id                                                        as subscriber_id,
  sub.email,
  sub.company,
  sub.status,
  sub.subscribed_at,
  count(*) filter (where e.event = 'opened'  and e.created_at >= now() - interval '90 days') as opens_90d,
  count(*) filter (where e.event = 'clicked' and e.created_at >= now() - interval '90 days') as clicks_90d,
  max(e.created_at) filter (where e.event = 'opened')           as last_opened_at,
  max(e.created_at) filter (where e.event = 'clicked')          as last_clicked_at
from public.newsletter_subscribers sub
left join public.newsletter_events e on e.subscriber_id = sub.id
group by sub.id, sub.email, sub.company, sub.status, sub.subscribed_at;
