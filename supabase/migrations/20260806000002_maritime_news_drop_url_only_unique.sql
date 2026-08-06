-- 20260806000001 の続き。url 単独の一意制約が残っていた。
--
-- ■ なぜ前回で終わらなかったか
-- 前回は maritime_news_url_key を名指しで落としたが、実際に効いていたのは
-- maritime_news_url_uniq という別名だった。この名前はマイグレーションの
-- どのファイルにも無い — ダッシュボードで直接作られたか、古い設定の名残である。
-- 名指しで消す限り、名前を取り違えたときに黙って何も起きない。
--
-- ■ 今回のやり方
-- 名前を当てにせず、「url 一列だけの一意制約・一意インデックス」を探して落とす。
-- (url, lang) の複合キーは二列なので対象にならない。
-- 何を落としたかは NOTICE に出す — 黙って通ると、効いたのか確認できない。

do $$
declare r record;
begin
  -- 一意制約(constraint)側
  for r in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace ns on ns.oid = rel.relnamespace
    where ns.nspname = 'public'
      and rel.relname = 'maritime_news'
      and con.contype = 'u'
      and con.conkey = array[(
        select attnum from pg_attribute
        where attrelid = rel.oid and attname = 'url' and not attisdropped
      )]::smallint[]
  loop
    execute format('alter table public.maritime_news drop constraint %I', r.conname);
    raise notice 'dropped constraint %', r.conname;
  end loop;

  -- 制約を伴わない一意インデックス側
  for r in
    select i.indexrelid::regclass::text as idxname
    from pg_index i
    join pg_class rel on rel.oid = i.indrelid
    join pg_namespace ns on ns.oid = rel.relnamespace
    where ns.nspname = 'public'
      and rel.relname = 'maritime_news'
      and i.indisunique
      and i.indnatts = 1
      and i.indkey[0] = (
        select attnum from pg_attribute
        where attrelid = rel.oid and attname = 'url' and not attisdropped
      )
      and not exists (select 1 from pg_constraint c where c.conindid = i.indexrelid)
  loop
    execute format('drop index if exists %s', r.idxname);
    raise notice 'dropped index %', r.idxname;
  end loop;
end $$;

-- 前回で入っているはずだが、入っていない環境のために冪等に置く。
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'maritime_news_url_lang_key'
      and conrelid = 'public.maritime_news'::regclass
  ) then
    alter table public.maritime_news
      add constraint maritime_news_url_lang_key unique (url, lang);
    raise notice 'added maritime_news_url_lang_key';
  end if;
end $$;
