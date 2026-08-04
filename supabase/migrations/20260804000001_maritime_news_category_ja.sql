-- maritime_news.category に日本語のカテゴリを許可する。
--
-- 日本版サイト(jpn.logisight.net)は lang='ja' の記事だけを扱い、カテゴリの
-- 絞り込みも日本語の値で行う。既存の CHECK 制約は韓国語の値しか許さないため、
-- 日本語行の INSERT が maritime_news_category_check で弾かれていた。
--
-- 既存の韓国語の値はそのまま残す(韓国版が使用中)。日本語の値を足すだけである。
-- '철도-북미' は既存データにあるので落とすと既存行が制約違反になる。

ALTER TABLE maritime_news DROP CONSTRAINT IF EXISTS maritime_news_category_check;

ALTER TABLE maritime_news ADD CONSTRAINT maritime_news_category_check
  CHECK (
    category IS NULL
    OR category IN (
      -- 韓国版(既存)
      '해상', '항공', '철도', '물류', '무역', '철도-북미',
      -- 日本版
      '海上', '航空', '鉄道', '物流', '貿易', '港湾'
    )
  );
