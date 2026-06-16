'use strict';
// 기존 maritime_news 기사의 '닫는 문단'에서 한국 화주·포워더 프레이밍을 제거한다.
//   - '빈 마무리형'(화주·포워더와 관련/영향 없다 류) → 문단 삭제
//   - 그 외 → DeepSeek로 시장 전망형 재작성
// MODE=classify : API·DB 쓰기 없이 분류만 출력
// MODE=apply    : 원본 백업 → 재작성/삭제 → DB 적용 → 리포트 파일 기록
const ws = require('ws'); globalThis.WebSocket = ws;
require('dotenv').config({ path: '.env.local' });
const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');
const { callDeepSeek } = require('../generators/lib/deepseek');

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false }, realtime: { enabled: false },
});

const RE = /한국\s*화주|화주[와나·ㆍ]\s*포워더|포워더는|화주·포워더|포워더라면|포워더들은|화주\s*입장|포워더\s*입장/;
// '빈 마무리형': 화주·포워더와의 관련성/영향/언급이 없다는 비-진술 문단
const EMPTY_RE = /(직접적\s*)?(연관성|관련성|영향|언급)[\s\S]{0,30}?(없|불분명|확인되지|찾기\s*어렵)/;
const isFooter = (b) => /^-{3,}$/.test(b) || /^\*?\s*출처\s*[:：]/.test(b);

function closingIdx(blocks) {
  let i = blocks.length - 1;
  while (i >= 0 && isFooter(blocks[i])) i--;
  return i;
}

async function rewriteClosing(fullBody, closingPara) {
  const system = '당신은 한국 물류·해운 전문지 기자다. KSG 문어체만 쓴다(~을 기록했다·~을 밝혔다·~로 집계됐다·~로 전망했다·~고 말했다). ~입니다·~합니다·~됩니다는 절대 금지.';
  const user = `다음은 한 기사의 전문이다. 마지막 닫는 문단을 한국 화주·포워더 언급 없이 '향후 시장 전망'으로 다시 써라.

규칙:
- 한국 화주/포워더/화주를 직접 언급하지 마라.
- 시장 전망·업계 시각으로 마무리한다. 도입을 변주한다(예: '업계에서는…', '글로벌 공급망 차원에서…', '업계 전문가는 ~라고 했다', '시장에서는…').
- 기존 닫는 문단과 비슷한 분량(2~4문장)으로 쓴다.
- 기사 본문에 없는 새로운 사실·수치·연도·전망을 지어내지 마라. 본문 범위 안에서만 재구성하라.
- 새 닫는 문단의 '본문 텍스트만' 출력한다. 제목·라벨·따옴표·설명 없이.

[기사 전문]
${fullBody}

[다시 쓸 기존 닫는 문단]
${closingPara}`;
  const msg = await callDeepSeek({ system, messages: [{ role: 'user', content: user }], max_tokens: 800 });
  return (msg.content?.[0]?.text || '').trim();
}

async function main() {
  const MODE = process.env.MODE || 'classify';
  const { data, error } = await sb.from('maritime_news')
    .select('id,title,published_at,content').not('content', 'is', null)
    .order('published_at', { ascending: false });
  if (error) throw error;

  const candidates = [];
  for (const r of data) {
    const blocks = String(r.content).trim().split(/\n{2,}/).map((s) => s.trim()).filter(Boolean);
    const ci = closingIdx(blocks);
    if (ci < 0) continue;
    const closing = blocks[ci];
    if (!RE.test(closing)) continue;
    const action = EMPTY_RE.test(closing) ? 'delete' : 'rewrite';
    candidates.push({ row: r, closing, action });
  }

  const del = candidates.filter((c) => c.action === 'delete');
  const rw = candidates.filter((c) => c.action === 'rewrite');
  console.log(`대상 ${candidates.length}건 = 삭제 ${del.length} + 재작성 ${rw.length}\n`);
  console.log('--- 삭제 대상(빈 마무리형) ---');
  for (const c of del) console.log(`  id ${c.row.id}: ${c.closing.slice(0, 90)}`);

  if (MODE === 'classify') {
    console.log('\n[classify] API·DB 쓰기 없음. MODE=apply 로 실제 적용.');
    return;
  }

  // ---- apply ----
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const backup = candidates.map((c) => ({ id: c.row.id, content: c.row.content }));
  const backupPath = `scripts/backup-closing-${ts}.json`;
  fs.writeFileSync(backupPath, JSON.stringify(backup, null, 2), 'utf-8');
  console.log(`\n원본 백업: ${backupPath} (${backup.length}건)`);

  const report = [];
  let updated = 0;
  for (const c of candidates) {
    const before = c.closing;
    if (c.row.content.indexOf(before) === -1) {
      report.push({ id: c.row.id, status: 'SKIP(닫는문단 매칭 실패)' });
      continue;
    }
    let newContent;
    if (c.action === 'delete') {
      newContent = c.row.content.replace(before, '').replace(/\n{3,}/g, '\n\n').trim();
    } else {
      let after;
      try { after = await rewriteClosing(c.row.content, before); }
      catch (e) { report.push({ id: c.row.id, status: `FAIL(${e.message})` }); continue; }
      if (!after || after.length < 30) { report.push({ id: c.row.id, status: 'FAIL(짧은 응답)' }); continue; }
      newContent = c.row.content.replace(before, after);
    }
    const { error: upErr } = await sb.from('maritime_news').update({ content: newContent }).eq('id', c.row.id);
    if (upErr) { report.push({ id: c.row.id, status: `DB오류(${upErr.message})` }); continue; }
    updated++;
    report.push({
      id: c.row.id, action: c.action, title: c.row.title,
      before, after: c.action === 'delete' ? '(삭제됨)' : newContent.replace(c.row.content.replace(before, ''), '').trim(),
    });
  }

  const reportPath = `scripts/rewrite-closing-report-${ts}.txt`;
  const lines = report.map((r) => {
    if (r.status) return `id ${r.id} — ${r.status}`;
    return `===== id ${r.id} [${r.action}] ${r.title}\n--- BEFORE ---\n${r.before}\n--- AFTER ---\n${r.after}\n`;
  });
  fs.writeFileSync(reportPath, lines.join('\n'), 'utf-8');
  console.log(`적용 완료: ${updated}/${candidates.length}건 업데이트`);
  console.log(`리포트: ${reportPath}`);
  const fails = report.filter((r) => r.status);
  if (fails.length) { console.log('실패/스킵:'); for (const f of fails) console.log(`  id ${f.id}: ${f.status}`); }
}

main().catch((e) => { console.error(e.message); process.exit(1); });
