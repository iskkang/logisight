-- Phase 6: Intelligence Layer — forecasts (전망/판단 트래킹)
-- AI 초안(status='draft') → 에디터 검수 → published. 발행 후 본문 불변(무효 조건 예외).

create table if not exists forecasts (
  id uuid primary key default gen_random_uuid(),
  module text not null check (module in ('rates', 'eurasia', 'trade', 'policy')),
  statement text not null,                 -- 전망 본문(현상→원인→배경→전망)
  basis jsonb,                             -- 근거 지표·수치 배열
  impact_note text,                        -- 화주 영향 번역문(FEU/kg 비용·리드타임)
  horizon_date date,                       -- 판정 기준일
  confidence text check (confidence in ('high', 'medium', 'low')),
  invalidation_condition text,             -- 무효 조건(예: 해협 재개방)
  status text not null default 'draft' check (status in ('draft', 'published', 'resolved')),
  outcome text check (outcome in ('hit', 'partial', 'miss')),
  outcome_note text,                       -- 복기(miss·partial 시 필수 — 앱/검수에서 강제)
  metric_ref text,                         -- 판정용 지표 참조(예: KCCI, delay_index_weekly:KR-ANDIJAN)
  created_at timestamptz not null default now(),
  published_at timestamptz,
  resolved_at timestamptz
);

create index if not exists forecasts_module_status_idx on forecasts (module, status);
create index if not exists forecasts_horizon_idx on forecasts (horizon_date) where status = 'published';

-- 발행 후 본문 수정·삭제 불가. draft→published(발행)는 허용, published 이후 status/outcome 계열만 변경 허용.
create or replace function forecasts_guard_published()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then
      raise exception 'published/resolved forecasts cannot be deleted';
    end if;
    return old;
  end if;
  if old.status <> 'draft' then
    if new.module is distinct from old.module
       or new.statement is distinct from old.statement
       or new.basis is distinct from old.basis
       or new.impact_note is distinct from old.impact_note
       or new.horizon_date is distinct from old.horizon_date
       or new.confidence is distinct from old.confidence
       or new.invalidation_condition is distinct from old.invalidation_condition
       or new.metric_ref is distinct from old.metric_ref then
      raise exception 'published forecasts are immutable except status/outcome fields';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists forecasts_guard on forecasts;
create trigger forecasts_guard
  before update or delete on forecasts
  for each row execute function forecasts_guard_published();

grant select on forecasts to anon, authenticated;
grant all on forecasts to service_role;
alter table forecasts enable row level security;

-- 공개 화면은 published/resolved만 노출. 적중률 표본에서 빼지 않도록 전수 노출.
create policy "forecasts_public_read" on forecasts
  for select using (status in ('published', 'resolved'));
create policy "forecasts_admin_all" on forecasts
  for all to authenticated
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));
