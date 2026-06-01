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
const SECTIONS = require('./sections.config');
const { buildNewsCandidates } = require('./lib/rss-candidates');

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
  // ── 후보 수집: RSS 풀 → 폴백 시 기존 monthly items ──
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  let items = [];
  let rssMode = false;
  try {
    const rssCandidates = await buildNewsCandidates();
    if (rssCandidates && rssCandidates.length >= N * 2) {
      items = rssCandidates.slice(0, 40).map(c => ({
        title:        c.title,
        url:          c.url,
        source:       c.source,
        summary_en:   c.summary,
        published_at: c.pub_date,
        score:        c.score,
        source_count: c.source_count,
      }));
      rssMode = true;
      console.log(`  build-featured: RSS 후보 ${items.length}건 사용`);
    }
  } catch (e) {
    console.warn('  build-featured: RSS 빌드 실패, monthly items 폴백:', e.message);
  }
  if (!rssMode) {
    items = loadAllMonthlyItems()
      .filter(i => i.url && i.title && MARITIME.test(`${i.title} ${i.summary_en || ''} ${i.source || ''}`))
      .slice(0, 40);
  }
  if (!items.length) { console.log('해운 기사 없음 — 대표 기사 스킵'); return; }

  const list = items.map((it, n) => {
    const scoreInfo = it.score != null
      ? ` [score=${it.score} cross=${it.source_count}매체]`
      : '';
    return `[${n}]${scoreInfo}\n${it.title} | ${it.source || ''} | ${it.url}\n${(it.summary_en || it.content || '').slice(0, 400)}`;
  }).join('\n\n');

  const sys = `당신은 Logisight 외부 고객용 월간 해운 리포트의 기사 에디터입니다. 후보 기사 중 ${MONTH} 해운 시장에서 가장 중요한 ${N}건을 선정해 각각 한국어 피처 기사로 작성합니다.
규칙:
① 객관 중립 — 특정 기업(MTL 등)·영업 권유·독자 행동 지시("~하라/검토하라") 절대 금지.
② [현상]·[원인]·[배경]·[전망] 같은 라벨·머리표 금지 — 자연스럽게 이어지는 산문.
③ 명사·명사형으로 종결하되 '~임/~함/~됨/~해짐' 어미를 붙이지 말 것(전망임→전망, 조정됨→조정, 가능함→가능, 작용 중임→작용 중). 경어체·평서체 금지.
④ 후보 기사에 있는 사실만 사용(환각 금지). 수치엔 출처·단위.
⑤ JSON만 출력(설명·코드펜스 없이).
⑥ score(높을수록 중요)·cross(교차보도 매체 수)가 표시된 후보는 그 수치를 참고해 중요한 기사를 우선 선정.
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
      `<div class="page-break"></div>\n\n<p class="article-cat">해운 시황</p>\n\n## ${a.title}\n\n#### ${a.subtitle}\n\n${img}${a.body}\n\n*출처: ${src.source || ''}${date ? ` · ${date}` : ''}*`
    );
  }

  // ── 주요 해운 기사: 해운(02) 다음·항공(03) 앞에 삽입 (맨 끝 append 아님) ──
  const featured = `<div class="page-break"></div>\n\n# 주요 해운 기사\n\n${blocks.join('\n\n')}\n`;
  let draft = fs.readFileSync(DRAFT, 'utf-8');

  // 재실행 시 중복 방지: 이미 삽입돼 있으면 건너뜀(먼저 assemble 재실행 권장)
  if (/\n#{1,3}\s+주요\s*해운\s*기사/.test(draft)) {
    console.log('⚠️ draft에 이미 "주요 해운 기사"가 있음 — 삽입 건너뜀(중복 방지). 새로 넣으려면 assemble 먼저 재실행.');
    return;
  }

  const esc        = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const airTitle   = (SECTIONS.find(s => s.id === 'air')   || {}).title || '항공 화물';
  const oceanTitle = (SECTIONS.find(s => s.id === 'ocean') || {}).title || '해운 시황';

  // 1순위: 항공 섹션 제목(예: "# 03. 항공 화물") 바로 앞에 삽입
  let m = draft.match(new RegExp('\\n#{1,3}\\s+' + esc(airTitle)));
  // 2순위: 항공 번호 헤딩(03.) — 제목이 미세하게 달라진 경우
  if (!m) m = draft.match(/\n#{1,3}\s+0?3\.\s[^\n]*/);

  if (m) {
    const at = draft.indexOf(m[0]) + 1;                 // 앞 개행 다음 '#' 위치
    draft = draft.slice(0, at) + featured + '\n\n---\n\n' + draft.slice(at);
    fs.writeFileSync(DRAFT, draft, 'utf-8');
    console.log(`✅ 대표 기사 ${blocks.length}건 — 항공 섹션 앞에 삽입`);
  } else {
    // 3순위(폴백): 해운 섹션 뒤 첫 구분선에 삽입
    const om = draft.match(new RegExp('#{1,3}\\s+' + esc(oceanTitle)));
    let inserted = false;
    if (om) {
      const sepRe = /\n\n---\n\n/g;
      sepRe.lastIndex = draft.indexOf(om[0]) + om[0].length;
      const sep = sepRe.exec(draft);
      if (sep) {
        const at = sep.index + sep[0].length;
        draft = draft.slice(0, at) + featured + '\n\n---\n\n' + draft.slice(at);
        fs.writeFileSync(DRAFT, draft, 'utf-8');
        inserted = true;
        console.log(`✅ 대표 기사 ${blocks.length}건 — 해운 섹션 뒤에 삽입(폴백)`);
      }
    }
    if (!inserted) {
      fs.appendFileSync(DRAFT, `\n\n---\n\n${featured}`, 'utf-8');
      console.log(`⚠️ 항공/해운 섹션 위치 못 찾음 — 대표 기사 ${blocks.length}건 맨 끝에 추가`);
    }
  }
}
main().catch(e => { console.error(e); process.exit(1); });
