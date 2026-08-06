-- maritime_news_url_uniq を名指しで落とす。
--
-- 20260806000002 は「url 一列だけの一意制約」を定義から探して落とす書き方に
-- したが、実際の環境ではまだ残っていた。0002 が流されていない可能性が高い。
-- 名前が分かっている以上、遠回りする理由がない。
--
-- constraint と index の両方を書くのは、この名前がどちらで作られたのか
-- マイグレーション履歴に無いため。片方は空振りするが害はない。

alter table public.maritime_news drop constraint if exists maritime_news_url_uniq;
drop index if exists public.maritime_news_url_uniq;

-- 複合キーが無い環境のために冪等に置く。
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'maritime_news_url_lang_key'
      and conrelid = 'public.maritime_news'::regclass
  ) then
    alter table public.maritime_news
      add constraint maritime_news_url_lang_key unique (url, lang);
  end if;
end $$;

-- 効いたかどうかをその場で返す。0 行なら url 単独の一意はもう無い。
select conname as remaining_url_only_unique
from pg_constraint con
join pg_class rel on rel.oid = con.conrelid
where rel.relname = 'maritime_news'
  and con.contype = 'u'
  and array_length(con.conkey, 1) = 1;
