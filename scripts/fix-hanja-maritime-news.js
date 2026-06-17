'use strict';
// maritime_news 제목·소제목에 남은 어려운 한자 약물을 한글로 정정(legacy 기사 1회성 정리).
// 새 기사는 생성 프롬프트에서 이미 한자 금지 — 본 스크립트는 과거 기사 보정용.
//   node scripts/fix-hanja-maritime-news.js          # dry-run(미리보기, DB 미변경)
//   node scripts/fix-hanja-maritime-news.js --apply  # 백업 후 DB 적용
const fs = require('fs');
const ws = require('ws'); globalThis.WebSocket = ws;
require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');
const { callDeepSeekJson } = require('../generators/lib/deepseek');

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false }, realtime: { enabled: false },
});
const HAN = /[一-鿿]/;
const APPLY = process.argv.includes('--apply');

async function fetchAll() {
  let from = 0, all = [];
  for (;;) {
    const { data, error } = await sb.from('maritime_news')
      .select('id,title,summary').order('published_at', { ascending: false }).range(from, from + 999);
    if (error) throw new Error(error.message);
    all = all.concat(data);
    if (data.length < 1000) break;
    from += 1000;
  }
  return all.filter(r => HAN.test(r.title || '') || HAN.test(r.summary || ''));
}

async function rewrite(rows) {
  const system = `너는 한국 물류 기사 교열자다. 입력 기사들의 제목(title)과 소제목(summary)에서 "어려운 한자 약물"만 한글로 바꾼다.
규칙:
- 弗→달러, 億→억, 比→대비, 美→미국(또는 문맥상 '미'), 亞→아시아, 中→중국, 北→북, 發→발, 行→행, 前倒→앞당김, 脫出→탈출, 對→대, 韓→한국, 新→신, 東→동, 西→서, 南→남.
- 예: "亞發 美서안"→"아시아발 미서안", "전주比"→"전주 대비", "中東發"→"중동발", "脫出 실패"→"탈출 실패", "성수기 前倒"→"성수기 앞당김".
- 수치·기호(%·↑·↓·…)·영문 사명(CMA CGM·MSC 등)·TEU·고유명사·의미는 절대 바꾸지 않는다.
- 한자가 없던 부분은 그대로 둔다.
반드시 JSON만 출력: {"results":[{"id":"...","title":"...","summary":"..."}, ...]} (입력과 동일 순서·개수).`;
  const list = rows.map(r => ({ id: r.id, title: r.title || '', summary: r.summary || '' }));
  const out = await callDeepSeekJson({
    system,
    messages: [{ role: 'user', content: `다음 ${rows.length}건을 정정하라:\n${JSON.stringify(list, null, 2)}` }],
    max_tokens: 4096,
  });
  return (out && out.results) || [];
}

(async () => {
  const rows = await fetchAll();
  console.log(`한자 포함 기사: ${rows.length}건`);
  if (!rows.length) return;

  const fixed = await rewrite(rows);
  const byId = new Map(fixed.map(r => [String(r.id), r]));

  const changes = [];
  for (const r of rows) {
    const f = byId.get(String(r.id));
    if (!f) { console.warn(`  ⚠️ 응답 누락(원본 유지): ${r.title}`); continue; }
    const stillHan = HAN.test(f.title || '') || HAN.test(f.summary || '');
    const changed = (f.title || '') !== (r.title || '') || (f.summary || '') !== (r.summary || '');
    if (!changed) continue;
    changes.push({ id: r.id, before: { title: r.title, summary: r.summary }, after: { title: f.title, summary: f.summary }, stillHan });
    console.log(`\n  ${stillHan ? '⚠️한자잔존' : '✓'}`);
    console.log(`   - ${r.title}`);
    console.log(`   + ${f.title}`);
  }
  console.log(`\n정정 대상: ${changes.length}건`);

  if (!APPLY) { console.log('\n(dry-run — DB 미변경. 적용: --apply)'); return; }

  const backup = `scripts/backup-hanja-fix-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  fs.writeFileSync(backup, JSON.stringify(changes, null, 2), 'utf8');
  console.log(`백업: ${backup}`);
  let ok = 0;
  for (const c of changes) {
    const { error } = await sb.from('maritime_news').update({ title: c.after.title, summary: c.after.summary }).eq('id', c.id);
    if (error) console.error(`  ❌ ${c.id}: ${error.message}`); else ok++;
  }
  console.log(`✅ 적용: ${ok}/${changes.length}건`);
})().catch(e => { console.error('실패:', e.message); process.exit(1); });
