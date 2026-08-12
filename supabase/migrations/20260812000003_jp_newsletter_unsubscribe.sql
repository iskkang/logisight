-- 配信停止。メール内のリンクから、ログインせずに一度で止められるようにする。
--
-- 特定電子メール法は、受け取る側がいつでも配信を止められることを求める。
-- ログインを要求すると、パスワードを忘れた人は止められない。
-- リンクを踏むだけで止まる必要がある。
--
-- SECURITY DEFINER にするのは、匿名クライアントに jp_profiles を直接
-- 触らせないためである。この関数は「その user_id の配信を止める」以外の
-- ことができない。
--
-- user_id は UUID なので推測はできないが、リンクを知っていれば他人でも
-- 止められる。これは韓国版の newsletter_unsubscribe と同じ割り切りで、
-- 「止めにくいより、止めやすい」を採る。止めても記事は読める。

create or replace function public.jp_newsletter_unsubscribe(p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  was boolean;
begin
  select newsletter_opt_in into was from jp_profiles where user_id = p_user_id;
  if was is null then
    return false;          -- そんな登録は無い
  end if;
  if was = false then
    return false;          -- すでに止まっている
  end if;
  update jp_profiles
     set newsletter_opt_in = false,
         opt_out_at = now(),
         updated_at = now()
   where user_id = p_user_id;
  return true;
end;
$$;

revoke all on function public.jp_newsletter_unsubscribe(uuid) from public;
grant execute on function public.jp_newsletter_unsubscribe(uuid) to anon, authenticated;

comment on function public.jp_newsletter_unsubscribe(uuid) is
  'メール内リンクからの配信停止。停止できたら true、元から止まっていれば false。';
