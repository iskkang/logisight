'use strict';
// generators/jp-news/prune-dup.js
// slug にハングルが残った日本語行を削除する。一回限り。
//
// 元記事(韓国語)側に、ほぼ同じ内容が別 slug で二重に入っている記事がある。
// その両方を翻訳した結果、新方式の slug(掲載日-元記事ID)が既存行と衝突し、
// 付け替えが url の一意制約で弾かれた。内容は既存行と重複しているので落とす。

const path = require('path');
const ws = require('ws');
globalThis.WebSocket = ws;

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env.local') });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const HANGUL = /[가-힣]/;

async function main() {
  const dry = process.argv.includes('--dry');
  const { data, error } = await supabase
    .from('maritime_news')
    .select('id,slug,title')
    .eq('lang', 'ja')
    .limit(1000);
  if (error) throw new Error(error.message);

  const targets = (data ?? []).filter((r) => HANGUL.test(r.slug ?? ''));
  console.log(`🧹 ハングル slug の日本語行 ${targets.length}件${dry ? ' (dry-run)' : ''}`);
  for (const r of targets) console.log(`   id=${r.id} ${r.title}`);
  if (dry || targets.length === 0) return;

  const { error: delErr } = await supabase
    .from('maritime_news')
    .delete()
    .in('id', targets.map((r) => r.id));
  if (delErr) throw new Error(delErr.message);
  console.log(`✅ 削除 ${targets.length}件`);
}

if (require.main === module) {
  main().catch((e) => {
    console.error('❌ 失敗:', e.message);
    process.exit(1);
  });
}
