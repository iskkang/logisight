'use strict';
// generators/jp-news/translate.js
// 韓国語で書かれた自社記事(maritime_news.lang='ko')を日本語に翻訳し、
// lang='ja' の行として同じテーブルに追加する。
//
// 使い方: node generators/jp-news/translate.js [--limit=20] [--dry]
//
// 設計メモ
// - maritime_news の一意キーは url。韓国語行は logisight.mtlship.com/article/{slug}、
//   日本語行は jpn.logisight.net/article/{slug} を使うので衝突しない。
// - slug も分ける(接尾辞 -ja)。同じ slug だと記事ページが言語を取り違える。
// - 翻訳対象は自社記事(source='Logisight')だけ。外部リンク行(lang='en')は
//   本文を持たず、翻訳しても原文サイトへ飛ばすだけで意味がない。

const path = require('path');
const ws = require('ws');
globalThis.WebSocket = ws;

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env.local') });

const { callClaudeJson } = require('../lib/claude');
const { JA_SLUG_SUFFIX, categoryJa, buildJaRow, needsTranslation } = require('./lib/rows');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

/** 一度に翻訳する本数。API 負荷と失敗時の巻き戻し量のバランス。 */
const DEFAULT_LIMIT = 20;

function systemPrompt() {
  return [
    'あなたは日本の物流専門メディアの翻訳記者だ。韓国語の物流記事を日本語に訳す。',
    '',
    '【文体】',
    '- 常体(だ・である)。敬体は使わない。',
    '- 日本の物流専門紙(日本海事新聞・日刊CARGO)の記事文体に合わせる。',
    '- 一文一情報。修飾を重ねて長くしない。',
    '',
    '【訳し方】',
    '- 逐語訳をしない。日本の読者が読んで自然な記事にする。',
    '- 数値・固有名詞・日付は原文のまま保つ。勝手に足したり丸めたりしない。',
    '- 原文にない情報を足さない。原文にある情報を落とさない。',
    '- 企業名・港湾名・船社名は日本で通用する表記にする(例: 롱비치항 → ロングビーチ港)。',
    '- 通貨は原文の単位を保つ。ドルはドルのまま、ウォンはウォンのまま。',
    '',
    '【韓国向けの記述】',
    '原文は韓国の荷主向けに書かれている。「한국 화주」「부산발」のように韓国を主語にした',
    '記述が出てきた場合、事実として原文にあるならそのまま訳す(例: 韓国発の運賃が上昇した)。',
    'ただし「我が国」「국내」のような、読者を韓国人と前提した言い回しは日本語では',
    '主語を明示して訳す(例: 국내 화주 → 韓国の荷主)。日本の読者が読者だからである。',
    '',
    '【禁止】',
    '- 推測の追加: 「〜とみられる」「〜の可能性がある」を原文にないのに足さない。',
    '- 情緒的な形容の追加。',
  ].join('\n');
}

function userPrompt(row) {
  return [
    '次の韓国語記事を日本語に訳し、JSON で返せ。',
    '',
    `【カテゴリ】${row.category ?? '(なし)'}`,
    `【見出し】${row.title}`,
    '',
    '【リード】',
    row.summary || '(なし)',
    '',
    '【本文】',
    row.content || '(なし)',
    '',
    '【出力】次のキーを持つ JSON のみ。前置きや説明は書かない。',
    '{',
    '  "title": "日本語の見出し(全角40字以内、名詞止め可)",',
    '  "summary": "日本語のリード(全角120字以内)",',
    '  "content": "日本語の本文(マークダウン。原文の段落構成を保つ)",',
    '  "tags": ["日本語のタグ", "3〜5個"]',
    '}',
  ].join('\n');
}

async function translateOne(row) {
  const out = await callClaudeJson({
    max_tokens: 8000,
    system: systemPrompt(),
    messages: [{ role: 'user', content: userPrompt(row) }],
    debugPrefix: `jp-news-${row.id}`,
  });
  if (!out || !out.title) throw new Error(`翻訳結果が空: id=${row.id}`);
  return out;
}

/** 翻訳済みの slug 集合。毎回全件を翻訳し直さないために使う。 */
async function existingJaSlugs() {
  const slugs = new Set();
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('maritime_news')
      .select('slug')
      .eq('lang', 'ja')
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    (data ?? []).forEach((r) => r.slug && slugs.add(r.slug));
    if (!data || data.length < PAGE) break;
  }
  return slugs;
}

/**
 * 翻訳元の自社記事をすべて取る。外部リンク行(slug なし)は本文を持たないので除く。
 *
 * 以前は limit*4 だけ取っていた。新しい順に並ぶため、翻訳が進むとその範囲が
 * すべて翻訳済みになり、残り(369件中169件)に到達できないまま止まっていた。
 */
async function fetchSourceRows() {
  const PAGE = 1000;
  const out = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('maritime_news')
      .select('id,slug,title,summary,content,category,source,published_at,image_url,image_source,image_credit,is_hero,agent_type')
      .eq('lang', 'ko')
      .not('slug', 'is', null)
      .order('published_at', { ascending: false })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

async function main() {
  const arg = (n, d) => {
    const f = process.argv.find((a) => a.startsWith(`--${n}=`));
    return f ? f.split('=').slice(1).join('=') : d;
  };
  const limit = Number(arg('limit', DEFAULT_LIMIT));
  const dry = process.argv.includes('--dry');

  console.log(`📰 日本語ニュース翻訳 (最大${limit}件${dry ? ' · dry-run' : ''})`);

  const [done, source] = await Promise.all([existingJaSlugs(), fetchSourceRows()]);
  const targets = source.filter((r) => needsTranslation(r, done)).slice(0, limit);

  console.log(`   対象 ${targets.length}件 (翻訳済み ${done.size}件 / 候補 ${source.length}件)`);
  if (targets.length === 0) return;

  let ok = 0;
  const failed = [];
  for (const row of targets) {
    try {
      const ja = await translateOne(row);
      const jaRow = buildJaRow(row, ja);
      if (dry) {
        console.log(`   [dry] ${row.category} → ${categoryJa(row.category)} | ${jaRow.title}`);
      } else {
        const { error } = await supabase
          .from('maritime_news')
          .upsert(jaRow, { onConflict: 'url', ignoreDuplicates: false });
        if (error) throw new Error(error.message);
        console.log(`   ✅ ${jaRow.slug} | ${jaRow.title}`);
      }
      ok += 1;
    } catch (e) {
      // 1本の失敗で全体を止めない。翻訳は再実行すれば未処理分だけ拾う。
      failed.push({ id: row.id, slug: row.slug, message: e.message });
      console.warn(`   ⚠️ id=${row.id} ${row.slug}: ${e.message}`);
    }
  }

  console.log(`\n${dry ? '(dry) ' : ''}完了 ${ok}/${targets.length}`);
  if (failed.length > 0) {
    console.warn(`⚠️ 失敗 ${failed.length}件 — 再実行すれば未処理分のみ処理する`);
    process.exitCode = failed.length === targets.length ? 1 : 0;
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.error('❌ 翻訳失敗:', e.message);
    process.exit(1);
  });
}

module.exports = { systemPrompt, userPrompt, JA_SLUG_SUFFIX };
