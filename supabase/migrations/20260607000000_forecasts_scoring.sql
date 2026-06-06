-- Phase 6: 전망 스코어링·자동판정 컬럼 추가.
-- 코드가 채점(direction/range/composite/factor_scores)하고, 자동 판정이 realized_pct를 채운다.
-- model_version: 보정 루프 키(어느 가중치 버전의 전망인지). metric_value_at_publish: % 판정 기준값.

alter table forecasts
  add column if not exists cadence text check (cadence in ('weekly', 'monthly')),
  add column if not exists direction text check (direction in ('up', 'flat', 'down')),
  add column if not exists strength text,
  add column if not exists expected_range_pct text,          -- 표시용 파생("+3~7")
  add column if not exists range_low_pct numeric,            -- 자동 판정 산식용 숫자 경계
  add column if not exists range_high_pct numeric,
  add column if not exists composite_score numeric,
  add column if not exists factor_scores jsonb,
  add column if not exists confidence_reason text,
  add column if not exists data_quality_flags jsonb,
  add column if not exists model_version text,               -- 보정 루프 필수 키
  add column if not exists metric_value_at_publish numeric,  -- 발행 시점 기준값(없으면 % 판정 불가)
  add column if not exists realized_pct numeric;             -- 판정 시 기록되는 실측 변화율

-- 재실행 중복 방지: 같은 지표·기준일·모델버전 전망은 1건.
create unique index if not exists forecasts_dedup_idx
  on forecasts (metric_ref, horizon_date, model_version)
  where metric_ref is not null and model_version is not null;

-- 불변 트리거 갱신: 신규 채점 필드도 발행 후 불변. 단 outcome/outcome_note/realized_pct/resolved_at은 변경 허용.
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
       or new.metric_ref is distinct from old.metric_ref
       or new.cadence is distinct from old.cadence
       or new.direction is distinct from old.direction
       or new.strength is distinct from old.strength
       or new.expected_range_pct is distinct from old.expected_range_pct
       or new.range_low_pct is distinct from old.range_low_pct
       or new.range_high_pct is distinct from old.range_high_pct
       or new.composite_score is distinct from old.composite_score
       or new.factor_scores is distinct from old.factor_scores
       or new.model_version is distinct from old.model_version
       or new.metric_value_at_publish is distinct from old.metric_value_at_publish then
      raise exception 'published forecasts are immutable except status/outcome/realized fields';
    end if;
  end if;
  return new;
end;
$$;
