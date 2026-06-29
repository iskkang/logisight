-- 뉴스레터 구독 활성화: anon 구독(INSERT) 허용 + 원클릭 수신거부 RPC.
-- 기존 020 마이그레이션은 service_role 정책만 있어 사이트 구독 폼(anon 키)이 RLS로 막혀 있었음.
-- 개인정보 보호: anon은 INSERT만 가능(목록 SELECT/UPDATE/DELETE 불가). 수신거부는 SECURITY DEFINER 함수로만.

-- 1) 구독 폼(anon) INSERT 허용 — status='active' 행만 삽입 가능
drop policy if exists "anon_subscribe" on public.newsletter_subscribers;
create policy "anon_subscribe" on public.newsletter_subscribers
  for insert to anon
  with check (status = 'active');

-- 2) 원클릭 수신거부 — id(uuid)를 토큰으로 받아 상태만 변경. RLS 우회(SECURITY DEFINER).
--    반환: true=이번에 해지됨, false=대상 없음/이미 해지됨. 데이터는 일절 노출하지 않음.
create or replace function public.newsletter_unsubscribe(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  affected integer;
begin
  update public.newsletter_subscribers
     set status = 'unsubscribed',
         unsubscribed_at = now()
   where id = p_id
     and status <> 'unsubscribed';
  get diagnostics affected = row_count;
  return affected > 0;
end;
$$;

revoke all on function public.newsletter_unsubscribe(uuid) from public;
grant execute on function public.newsletter_unsubscribe(uuid) to anon, authenticated;
