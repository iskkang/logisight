-- 기상 리스크 지구본 — STEP 6: pg_cron 자동 갱신 (검증 끝난 뒤에만 실행).
-- ⚠ 이 파일은 migrations/ 가 아니라 docs/ 에 둔다 (db push 자동 적용 대상 아님).
--   이유: (1) <SERVICE_ROLE_KEY> 를 git에 커밋하지 않기 위해, (2) 수동 1회 검증 후 실행하기 위해.
--
-- 실행 전: risk-refresh 를 수동 1회 호출해 asset_risk 가 채워졌는지 확인할 것.
--   npx supabase functions invoke risk-refresh
--   select count(*) from public.asset_risk;   -- 26 * 4 = 104 행 기대
--
-- 실행 방법: 아래 <SERVICE_ROLE_KEY> 를 .env.local 의 SUPABASE_SERVICE_ROLE_KEY 로 바꿔
--            Supabase SQL 에디터에서 1회 실행. (service_role 키는 Vault에 저장되어 평문 노출 안 됨.)

-- 1) service_role 키를 Vault에 보관
select vault.create_secret('<SERVICE_ROLE_KEY>', 'service_role_key');

-- 2) 6시간마다 risk-refresh 호출
select cron.schedule('risk-refresh-6h', '0 */6 * * *', $$
  select net.http_post(
    url     := 'https://hmgbvqczmyjixkqbruzp.supabase.co/functions/v1/risk-refresh',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name='service_role_key'),
      'Content-Type', 'application/json'),
    body    := '{}'::jsonb
  );
$$);

-- 확인:
--   select * from cron.job;
--   select * from public.asset_risk order by updated_at desc limit 5;   -- 다음 실행 후 updated_at 갱신 확인
