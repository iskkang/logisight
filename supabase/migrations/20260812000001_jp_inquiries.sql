-- 日本版の問い合わせ受付。
--
-- ■ なぜテーブルに残すのか
-- メール通知だけでは、届かなかった一件が誰にも分からないまま消える。
-- 受け付けた事実を先に残し、通知はその後に送る。通知が落ちても本文は残る。
--
-- ■ source を持つ理由
-- どの導線から来たのかを残す。バナー広告が実際に問い合わせを生むのかは、
-- これが無いと測れない。会社サイトへ送っていた間はそこが切れていた。

create table if not exists public.jp_inquiries (
  id           bigserial primary key,
  name         text not null,
  company      text,
  email        text not null,
  phone        text,
  message      text not null,
  -- 流入元。'ad-mtl-ca'(バナー)・'footer'・'direct' など。
  source       text,
  -- 送信元ページ。同じ source でもどのページから押したかが分かる。
  referrer     text,
  status       text not null default 'new' check (status in ('new', 'handled', 'spam')),
  created_at   timestamptz not null default now(),
  handled_at   timestamptz
);

create index if not exists jp_inquiries_created_idx on public.jp_inquiries (created_at desc);
create index if not exists jp_inquiries_source_idx  on public.jp_inquiries (source);

alter table public.jp_inquiries enable row level security;

-- 匿名は読めない。問い合わせ内容は個人情報であり、書き込みもサーバー関数
-- (service_role)経由に限る。anon に insert を与えると、フォームを通さない
-- 直接投稿でいくらでも埋められる。
drop policy if exists jp_inquiries_no_anon on public.jp_inquiries;

comment on table public.jp_inquiries is
  '日本版の問い合わせ。書き込みはサーバー関数のみ、閲覧は service_role のみ。';
comment on column public.jp_inquiries.source is
  '流入元。広告バナー経由かどうかを測るために持つ。';
