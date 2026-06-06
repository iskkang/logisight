-- Phase 6 v1.3: forecasts.watch_points — 확인 포인트(label/source/due). data_release_calendar.due 기반.
-- 발행 후 불변(나머지 채점·산출 필드와 동일). draft 단계에선 수정 가능.

alter table forecasts add column if not exists watch_points jsonb;

-- 불변 트리거에 watch_points 편입(발행 후 변경 차단). 나머지 가드 필드는 20260607000000과 동일.
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
       or new.confidence_reason is distinct from old.confidence_reason
       or new.data_quality_flags is distinct from old.data_quality_flags
       or new.model_version is distinct from old.model_version
       or new.metric_value_at_publish is distinct from old.metric_value_at_publish
       or new.watch_points is distinct from old.watch_points then
      raise exception 'published forecasts are immutable except status/outcome/realized fields';
    end if;
  end if;
  return new;
end;
$$;
