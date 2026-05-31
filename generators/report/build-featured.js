'use strict';
// 대표 해운 기사 N건: LLM 선정·작성 + OG 이미지 fetch → assemble된 draft에 추가
// 사용법: node generators/report/build-featured.js [--month=2026-05]
//   ※ assemble-monthly-report.js 실행 후, monthly-report-pdf.js 실행 전에 돌릴 것
const fs   = require('fs');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env.local') });
if (typeof globalThis.WebSocket === 'undefined') { try { globalThis.WebSocket = require('ws'); } catch (_) {} }
const Anthropic = require('@anthropic-ai/sdk');
const { loadAllMonthlyItems } = require('./lib/index-factsheet');

const TODAY    = new Date().toISOString().slice(0, 10);
const monthArg = process.argv.find(a => a.startsWith('--month='));
const MONTH    = monthArg ? monthArg.split('=')[1] : TODAY.slice(0, 7);
const N        = 4;  // 대표 기사 건수
const DRAFT    = path.resolve(__dirname, `../../content/drafts/monthly-analysis-${MONTH}.md`);

const MARITIME = /scfi|ccfi|운임|컨테이너|container|freight|port|항만|선사|carrier|vessel|선박|해운|shipping|ocean|maersk|msc|hapag|호르무즈|hormuz|blank sailing|블랭크|선복|drewry|wci|fbx|bdi|벙커|bunker|alliance|얼라이언스/i;

async function fetchOgImage(url) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LogisightBot/1.0)' } });
    if (!res.ok) return null;
    const html = await res.text();
    const m = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
           || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i)
           || html.match(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i);
    if (!m) return null;
    let img = m[1].replace(/&amp;/g, '&');
    if (img.startsWith('//')) img = 'https:' + img;
    else if (img.startsWith('/')) { const u = new URL(url); img = u.origin + img; }
    const ir = await fetch(img, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!ir.ok) return null;
    const ct = (ir.headers.get('content-type') || 'image/jpeg').split(';')[0];
    if (!/^image\//.test(ct)) return null;
    const buf = Buffer.from(await ir.arrayBuffer());
    if (buf.length > 3_000_000) return null;  // 3MB 초과 스킵(PDF 비대화 방지)
    return `data:${ct};base64,${buf.toString('base64')}`;
  } catch (_) { return null; }
}

async function main() {
  if (!fs.existsSync(DRAFT)) {
    console.error(`${DRAFT} 없음 — 먼저 assemble-monthly-report.js 실행`); process.exit(1);
  }
  const items = loadAllMonthlyItems()
    .filter(i => i.url && i.title && MARITIME.test(`${i.title} ${i.summary_en || ''} ${i.source || ''}`))
    .slice(0, 40);
  if (!items.length) { console.log('해운 기사 없음 — 대표 기사 스킵'); return; }

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const list = items.map((it, n) =>
    `[${n}] ${it.title} | ${it.source || ''} | ${it.url}\n${(it.summary_en || it.content || '').slice(0, 400)}`
  ).join('\n\n');

  const sys = `당신은 Logisight 외부 고객용 월간 해운 리포트의 기사 에디터입니다. 후보 기사 중 ${MONTH} 해운 시장에서 가장 중요한 ${N}건을 선정해 각각 한국어 피처 기사로 작성합니다.
규칙:
① 객관 중립 — 특정 기업(MTL 등)·영업 권유·독자 행동 지시("~하라/검토하라") 절대 금지.
② [현상]·[원인]·[배경]·[전망] 같은 라벨·머리표 금지 — 자연스럽게 이어지는 산문.
③ 명사형 종결(~함/됨/임/전망). 경어체·평서체 금지.
④ 후보 기사에 있는 사실만 사용(환각 금지). 수치엔 출처·단위.
⑤ JSON만 출력(설명·코드펜스 없이).
각 기사 형식: { "idx": 후보번호(정수), "title": "한국어 헤드라인(간결·임팩트)", "subtitle": "한 줄 부제", "body": "2~3문단(문단 사이 \\n\\n), 각 문단 3~5문장" }
출력: {"articles":[ ... ${N}건 ... ]}`;

  const resp = await anthropic.messages.create({
    model: 'claude-sonnet-4-6', max_tokens: 4500, system: sys,
    messages: [{ role: 'user', content: `후보 기사:\n\n${list}\n\n위에서 ${N}건 선정·작성. JSON만 출력.` }],
  });
  let txt = resp.content.filter(b => b.type === 'text').map(b => b.text).join('').replace(/```json|```/g, '').trim();
  let picked;
  try { picked = JSON.parse(txt).articles; }
  catch (e) { console.error('JSON 파싱 실패:', e.message); console.error(txt.slice(0, 400)); process.exit(1); }

  const blocks = [];
  for (const a of picked) {
    const src    = items[a.idx] || {};
    const dataUri = src.url ? await fetchOgImage(src.url) : null;
    console.log(`  · ${a.title} — 이미지 ${dataUri ? 'OK' : '없음'}`);
    const img  = dataUri ? `<img class="feature-img" src="${dataUri}" alt="">\n\n` : '';
    const date = src.published_at ? src.published_at.slice(0, 10) : '';
    blocks.push(
      `<div class="page-break"></div>\n\n## ${a.title}\n\n#### ${a.subtitle}\n\n${img}${a.body}\n\n*출처: ${src.source || ''}${date ? ` · ${date}` : ''}*`
    );
  }

  const section = `\n\n---\n\n<div class="page-break"></div>\n\n# 주요 해운 기사\n\n${blocks.join('\n\n')}\n`;
  fs.appendFileSync(DRAFT, section, 'utf-8');
  console.log(`✅ 대표 기사 ${blocks.length}건 추가 → ${DRAFT}`);
}
main().catch(e => { console.error(e); process.exit(1); });
