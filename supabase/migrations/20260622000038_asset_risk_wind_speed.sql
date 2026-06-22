-- asset_risk: 지속풍 기록 컬럼 추가 (wind_speed_10m 일별 max, m/s).
-- 풍속 스코어링을 돌풍(wind_gust)에서 지속풍으로 정정 — 지속풍은 별도 컬럼에 저장, gust 컬럼은 진단용 유지.
-- 추가 전용(additive). DO NOT APPLY automatically — run manually after review (또는 supabase db push).
alter table public.asset_risk add column if not exists wind_speed double precision;
