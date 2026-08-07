'use strict';
// generators/jp-news/lib/rows.js
// 日本語行の組み立て — 純粋関数のみ。DB も API も触らない。

/** 日本語行の slug 接尾辞。韓国語行と slug を分けないと記事ページが言語を取り違える。 */
const JA_SLUG_SUFFIX = '-ja';

/**
 * 日本語記事の slug。「掲載日-元記事ID」。
 *
 * 最初は韓国語 slug に -ja を足しただけだった。その結果 URL が
 *   /article/2026-08-03-중국-장쑤-국제-철도-...-ja
 * となり、日本語サイトのアドレスにハングルがそのまま残った(実際に本番でそうなった)。
 * パーセントエンコードされて検索結果にも出る。
 *
 * 日本の業界紙(日本海事新聞・LOGISTICS TODAY)は日付+番号の URL を使う。
 * 日本語のタイトルをそのまま slug にしても非 ASCII で同じ問題が起きるため、
 * 日付と元記事 ID で組む。短く、安定し、言語に依存しない。
 */
function jaSlug(src) {
  const date = String(src.published_at ?? '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? `${date}-${src.id}` : `n${src.id}`;
}

/** 日本版のサイト。url を分けることで maritime_news の一意キー(url)と衝突しない。 */
const JP_SITE = 'https://jpn.logisight.net';

/**
 * カテゴリ対応。サイトのカテゴリ絞り込みはこの値と一致していなければ何も返さない。
 * 鉄道はユーラシア鉄道の記事が中心で日本の荷主には周辺的だが、
 * 全体の約15%あるため落とさず残す — 何を読むかは読者が決める。
 */
const CATEGORY_JA = {
  해상: '海上',
  항공: '航空',
  철도: '鉄道',
  물류: '物流',
  무역: '貿易',
  항만: '港湾',
};

const categoryJa = (ko) => CATEGORY_JA[ko] ?? '物流';

/**
 * 日次ダイジェストは訳さない。
 *
 * 韓国版は一日分をまとめた「글로벌 물류 동향 브리프」を毎日作る。中身は
 * その日の個別記事の寄せ集めで、日付だけが違う同じ見出しになる。これを
 * そのまま訳して入れたところ、日本版のニュース一覧が
 * 「2026-07-30 グローバル物流動向ブリーフ」の列で埋まった(56件)。
 *
 * 個々の記事はグローバル媒体の記事として別に入るので、同じ内容を二度見せる
 * ことにもなる。訳す対象から外す。
 */
const DIGEST_TITLE = /글로벌\s*물류\s*동향\s*브리프|グローバル物流動向ブリーフ/;

/** すでに日本語行がある記事は飛ばす。再実行で未処理分だけを拾えるようにする。 */
function needsTranslation(row, doneSlugs) {
  if (!row.slug) return false;
  if (DIGEST_TITLE.test(row.title || '')) return false;
  return !doneSlugs.has(jaSlug(row));
}

/**
 * 韓国語行 + 翻訳結果 → 日本語行。
 * 画像・掲載日・hero フラグは原文の編集判断をそのまま引き継ぐ。
 * 翻訳で変えるのは言語に属する列(title/summary/content/category/tags)だけである。
 */
function buildJaRow(src, ja) {
  const slug = jaSlug(src);
  return {
    url: `${JP_SITE}/article/${slug}`,
    slug,
    lang: 'ja',
    title: ja.title,
    summary: ja.summary ?? null,
    content: ja.content ?? null,
    category: categoryJa(src.category),
    tags: Array.isArray(ja.tags) && ja.tags.length > 0 ? ja.tags : null,
    source: 'Logisight',
    agent_type: src.agent_type ?? null,
    published_at: src.published_at,
    image_url: src.image_url ?? null,
    image_source: src.image_source ?? null,
    image_credit: src.image_credit ?? null,
    is_hero: Boolean(src.is_hero),
  };
}

module.exports = { JA_SLUG_SUFFIX, JP_SITE, CATEGORY_JA, categoryJa, jaSlug, needsTranslation, buildJaRow };
