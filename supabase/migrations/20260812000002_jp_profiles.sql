-- 日本版の会員プロフィールと、メール配信の同意記録。
--
-- ■ なぜ会員登録とは別に持つのか
-- 登録は「データを見るため」に行われる。メールマガジンを受け取ることに同意した
-- わけではない。特定電子メール法はオプトイン方式で、広告・宣伝を含むメールは
-- あらかじめ同意を得た相手にしか送れず、同意を得た記録の保存も求められる。
-- アカウントがあることを同意とみなすと違反になる。
--
-- ■ 同意の記録
-- 同意した事実だけでなく、いつ・どこで同意したかを残す(opt_in_at・opt_in_source)。
-- 後から「送ってよい相手だったのか」を確認できるようにするためで、
-- newsletter_opt_in の真偽値だけでは足りない。
-- 解除も時刻を残す。再同意との区別がつかなくなる。
--
-- ■ Google 登録があるのでプロフィールは後段で受け取る
-- Google の画面に項目を足すことはできない。登録後にプロフィール入力を出し、
-- メール・Google のどちらで登録しても同じ道を通るようにする。

create table if not exists public.jp_profiles (
  user_id            uuid primary key references auth.users (id) on delete cascade,
  name               text not null,
  company            text,
  position           text,
  -- auth.users にもあるが、配信リストを引くたびに auth を join したくない。
  email              text not null,
  newsletter_opt_in  boolean not null default false,
  opt_in_at          timestamptz,
  -- 'signup'(登録直後の画面)・'footer'(購読フォーム)など。
  opt_in_source      text,
  opt_out_at         timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists jp_profiles_optin_idx
  on public.jp_profiles (newsletter_opt_in) where newsletter_opt_in;

alter table public.jp_profiles enable row level security;

-- 本人だけが自分の行を読み書きできる。配信リストの抽出は service_role で行う。
drop policy if exists jp_profiles_self_select on public.jp_profiles;
create policy jp_profiles_self_select on public.jp_profiles
  for select using (auth.uid() = user_id);

drop policy if exists jp_profiles_self_insert on public.jp_profiles;
create policy jp_profiles_self_insert on public.jp_profiles
  for insert with check (auth.uid() = user_id);

drop policy if exists jp_profiles_self_update on public.jp_profiles;
create policy jp_profiles_self_update on public.jp_profiles
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

comment on table public.jp_profiles is
  '日本版の会員プロフィール。newsletter_opt_in が true の行だけが配信対象。';
comment on column public.jp_profiles.opt_in_at is
  '同意した時刻。特定電子メール法が求める同意記録として残す。';
comment on column public.jp_profiles.opt_in_source is
  '同意を得た経路。どの画面で同意したかを後から確認できるようにする。';
