-- maritime_news の一意キーを url から (url, lang) へ。
--
-- ■ なぜ
-- 同じ記事を韓国語版と日本語版で持てなかった。url がテーブル全体で一意
-- だったため、グローバル媒体の記事(Container News・DC Velocity 等)を
-- 日本語で入れると、同じ url の韓国語行を upsert が上書きしてしまう。
-- 韓国サイトのその記事が日本語に化ける。
--
-- 自社記事は url を分けて(logisight.net と jpn.logisight.net)回避していたが、
-- 外部記事の url は原文でなければならない。原文へ送ることが価値だからである。
--
-- ■ 安全性
-- url が全体で一意だったので、(url, lang) の重複は定義上ゼロ。
-- 既存 5,635 行はそのまま通る。
--
-- ■ 併せて直すもの(コード側)
-- onConflict: 'url' を使っていた upsert は 'url,lang' に変える。
-- 特に publish-rail-eurasia.js は「同じ url の en 行を ko で置き換える」
-- 動作を url の全体一意性に頼っていた。lang が入ると置き換えではなく
-- 2行になるので、そちらは明示的に削除してから入れるよう直した。

alter table maritime_news drop constraint if exists maritime_news_url_key;

-- lang は既定値がある想定だが、null が混ざると一意制約が効かない
-- (null 同士は等しくないため、同じ url の行が何本でも入る)。
update maritime_news set lang = 'ko' where lang is null;
alter table maritime_news alter column lang set not null;

alter table maritime_news
  add constraint maritime_news_url_lang_key unique (url, lang);
