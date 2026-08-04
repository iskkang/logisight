-- reports に言語列を足す。
--
-- reports は韓国版(logisight.net)と日本版(jpn.logisight.net)で共有している。
-- 言語を区別する列がないため、日本語のレポートを入れると韓国版の一覧にも並ぶ。
-- id の接頭辞('jp-')で見分ける方法は規約に依存し、言語が増えると破綻する。
--
-- 既存行はすべて韓国語なので DEFAULT 'ko' で埋まる。
-- 韓国版・日本版の双方が lang で明示的に絞るように合わせて直すこと。
-- 順序に注意: このマイグレーション → 韓国版のクエリ修正をデプロイ → 日本語レポートの発行。
-- 逆順だと、韓国版が未修正のあいだ日本語レポートが韓国版の一覧に出る。

ALTER TABLE reports ADD COLUMN IF NOT EXISTS lang TEXT NOT NULL DEFAULT 'ko';

-- 一覧は言語ごとに period_start の降順で引く。
CREATE INDEX IF NOT EXISTS reports_lang_period_idx ON reports (lang, period_start DESC);
