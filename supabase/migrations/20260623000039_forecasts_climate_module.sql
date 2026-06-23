-- Phase 6 확장: forecasts.module에 'climate' 추가.
-- 기후 영향 AI 초안(활성 이벤트×노선 근접) 적재용. status='draft'로만 생성 → 에디터 검수 후 published.
-- DO NOT APPLY automatically — run manually after review.

alter table public.forecasts drop constraint if exists forecasts_module_check;
alter table public.forecasts
  add constraint forecasts_module_check
  check (module in ('rates', 'eurasia', 'trade', 'policy', 'climate'));
