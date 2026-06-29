-- 뉴스레터 구독자 프로필 확장: 구독 팝업에서 이름·회사명을 함께 수집.
-- anon INSERT 정책(20260629000011)은 그대로 유효 — 행 단위 정책이라 추가 컬럼도 삽입 가능.

alter table public.newsletter_subscribers
  add column if not exists name    text,
  add column if not exists company text;
