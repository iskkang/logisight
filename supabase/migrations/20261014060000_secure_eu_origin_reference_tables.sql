-- eu_origin_rules / eu_hs_crosswalk 는 FTA 원산지기준 참조 데이터다 — 공개 읽기, 서버만 쓰기.
--
-- 이 둘만 RLS 가 꺼져 있었다(public 스키마의 RLS 미적용 표 전체 = 이 둘뿐). 게다가 anon 에
-- SELECT 뿐 아니라 INSERT·UPDATE·DELETE·TRUNCATE 까지 열려 있었다. anon 키는 브라우저 번들에
-- 실려 나가는 공개 키이므로, 누구나 /customs 가 원산지 판정에 쓰는 10,869행(한-EU 5,665 +
-- 한-미 5,204)과 크로스워크 12,088행을 고치거나 지울 수 있었다. 판정이 조용히 틀어진다.
--
-- 읽기 권한은 유지해야 한다 —— eu-origin-assessment.ts 가 supabasePublicServer(publishable
-- = anon 키)로 읽는다. 적재는 ingest-kr-eu-psr-2007.py / ingest-kr-us-psr.py 가 service_role
-- 로 하므로 RLS 를 우회한다. 즉 읽기·쓰기 양쪽 경로 모두 영향이 없다.
--
-- 설정 모양은 같은 성격의 참조 표인 customs_nomenclature(20260928043000)에 맞춘다.

alter table public.eu_origin_rules enable row level security;

revoke all on table public.eu_origin_rules from anon, authenticated;
grant select on table public.eu_origin_rules to anon, authenticated;
grant select, insert, update, delete on table public.eu_origin_rules to service_role;

drop policy if exists "eu origin rules public read" on public.eu_origin_rules;
create policy "eu origin rules public read"
on public.eu_origin_rules
for select
to anon, authenticated
using (true);

alter table public.eu_hs_crosswalk enable row level security;

revoke all on table public.eu_hs_crosswalk from anon, authenticated;
grant select on table public.eu_hs_crosswalk to anon, authenticated;
grant select, insert, update, delete on table public.eu_hs_crosswalk to service_role;

drop policy if exists "eu hs crosswalk public read" on public.eu_hs_crosswalk;
create policy "eu hs crosswalk public read"
on public.eu_hs_crosswalk
for select
to anon, authenticated
using (true);
