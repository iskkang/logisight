-- 뉴스레터 구독 동의·관심분야: 마케팅 수신 동의(필수) + 관심 분야 수집.
-- marketing_consent: 동의 여부, consent_at: 동의 시각(법적 기록), interests: 관심 분야 배열.

alter table public.newsletter_subscribers
  add column if not exists marketing_consent boolean not null default false,
  add column if not exists consent_at         timestamptz,
  add column if not exists interests          text[] not null default '{}';

-- 동의 없는 구독 차단: anon INSERT 시 marketing_consent=true 강제(직접 API 호출 포함).
-- (관리자 수동 추가는 service_role로 RLS 우회하므로 영향 없음)
drop policy if exists "anon_subscribe" on public.newsletter_subscribers;
create policy "anon_subscribe" on public.newsletter_subscribers
  for insert to anon
  with check (status = 'active' and marketing_consent = true);
