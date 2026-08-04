'use strict';
// generators/jp-news/rekey-slugs.js
// 既存の日本語記事の slug/url を新方式(掲載日-元記事ID)に付け替える。一回限り。
//
// 旧方式は韓国語 slug に -ja を足しただけで、URL にハングルが残っていた:
//   /article/2026-08-03-중국-장쑤-국제-철도-...-ja
// 本文は翻訳済みなので、slug と url だけ差し替える(再翻訳しない)。
//
// 使い方: node generators/jp-news/rekey-slugs.js [--dry]

const path = require('path');
const ws = require('ws');
globalThis.WebSocket = ws;

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env.local') });

const { JA_SLUG_SUFFIX, JP_SITE, jaSlug } = require('./lib/rows');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const PAGE = 1000;

async function fetchAll(lang, select) {
  const out = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('maritime_news')
      .select(select)
      .eq('lang', lang)
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

async function main() {
  const dry = process.argv.includes('--dry');
  console.log(`🔑 日本語記事の slug 付け替え${dry ? ' (dry-run)' : ''}`);

  const [ja, ko] = await Promise.all([
    fetchAll('ja', 'id,slug,url,published_at'),
    fetchAll('ko', 'id,slug,published_at'),
  ]);
  // 旧 slug は「韓国語 slug + -ja」。元記事を引くための対応表。
  const byKoSlug = new Map(ko.filter((r) => r.slug).map((r) => [r.slug, r]));

  let done = 0;
  let skipped = 0;
  const failed = [];

  for (const row of ja) {
    if (!row.slug || !row.slug.endsWith(JA_SLUG_SUFFIX)) {
      skipped += 1; // すでに新方式
      continue;
    }
    const koSlug = row.slug.slice(0, -JA_SLUG_SUFFIX.length);
    const src = byKoSlug.get(koSlug);
    if (!src) {
      failed.push({ id: row.id, slug: row.slug, message: '元記事が見つからない' });
      continue;
    }
    // 元記事の id と掲載日で組む。日本語行の掲載日は元記事から引き継いでいる。
    const slug = jaSlug({ id: src.id, published_at: src.published_at ?? row.published_at });
    const url = `${JP_SITE}/article/${slug}`;

    if (dry) {
      console.log(`   [dry] ${row.slug}\n         → ${slug}`);
      done += 1;
      continue;
    }
    const { error } = await supabase.from('maritime_news').update({ slug, url }).eq('id', row.id);
    if (error) failed.push({ id: row.id, slug: row.slug, message: error.message });
    else done += 1;
  }

  console.log(`\n${dry ? '(dry) ' : ''}付け替え ${done}件 / すでに新方式 ${skipped}件`);
  if (failed.length > 0) {
    console.warn(`⚠️ 失敗 ${failed.length}件`);
    failed.slice(0, 5).forEach((f) => console.warn(`   id=${f.id} ${f.slug}: ${f.message}`));
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.error('❌ 付け替え失敗:', e.message);
    process.exit(1);
  });
}
