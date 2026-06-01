'use strict';
// 대표 해운 기사 N건: LLM 선정·작성 + OG 이미지 fetch → assemble된 draft에 추가
// 사용법: node generators/report/build-featured.js [--month=2026-05]
//   ※ assemble-monthly-report.js 실행 후, monthly-report-pdf.js 실행 전에 돌릴 것
const fs   = require('fs');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env.local') });
if (typeof globalThis.WebSocket === 'undefined') { try { globalThis.WebSocket = require('ws'); } catch (_) {} }
const { callDeepSeek } = require('../lib/deepseek');
const { loadAllMonthlyItems } = require('./lib/index-factsheet');
const SECTIONS = require('./sections.config');
const { buildNewsCandidates } = require('./lib/rss-candidates');
const { fetchOgImage } = require('./lib/og-image');

const TODAY    = new Date().toISOString().slice(0, 10);
const monthArg = process.argv.find(a => a.startsWith('--month='));
const MONTH    = monthArg ? monthArg.split('=')[1] : TODAY.slice(0, 7);
const N        = 4;   // 대표 기사 최대 건수
const DRAFT    = path.resolve(__dirname, `../../content/drafts/monthly-analysis-${MONTH}.md`);

// Fallback keyword filter for monthly-items mode
const MARITIME = /freight|container|shipping|vessel|carrier|port|terminal|ocean|maritime|alliance|blank.?sailing|capacity|supply.?chain|운임|해운|컨테이너|항만|공급망|선복/i;
const SHORT_BODY = 600;  // chars — articles shorter than this qualify for 2-up pairing

async function main() {
  if (!fs.existsSync(DRAFT)) {
    console.error(`${DRAFT} 없음 — 먼저 assemble-monthly-report.js 실행`); process.exit(1);
  }

  // ── 후보 수집: SeaSearch/RSS 풀 → 폴백 시 기존 monthly items ──
  let items = [];
  let rssMode = false;
  try {
    const rssCandidates = await buildNewsCandidates();
    if (rssCandidates && rssCandidates.length >= N * 2) {
      // Only pass pick_eligible candidates to LLM (hard gate: core OR cross ≥ 2)
      const eligible = rssCandidates.filter(c => c.pick_eligible !== false);
      items = eligible.slice(0, 40).map(c => ({
        title:        c.title,
        url:          c.url,
        source:       c.source,
        summary_en:   c.summary,
        published_at: c.pub_date,
        score:        c.score,
        source_count: c.source_count,
        is_core:      c.is_core,
      }));
      rssMode = true;
      console.log(`  build-featured: pick_eligible 후보 ${items.length}건 (전체 후보 ${rssCandidates.length}건 중)`);
    }
  } catch (e) {
    console.warn('  build-featured: RSS/SeaSearch 빌드 실패, monthly items 폴백:', e.message);
  }
  if (!rssMode) {
    items = loadAllMonthlyItems()
      .filter(i => i.url && i.title && MARITIME.test(`${i.title} ${i.summary_en || ''} ${i.source || ''}`))
      .slice(0, 40);
  }
  if (!items.length) { console.log('해운 기사 없음 — 대표 기사 스킵'); return; }

  const list = items.map((it, n) => {
    const meta = it.score != null
      ? ` [score=${it.score} cross=${it.source_count}매체${it.is_core ? ' CORE' : ''}]`
      : '';
    return `[${n}]${meta}\n${it.title} | ${it.source || ''} | ${it.url}\n${(it.summary_en || it.content || '').slice(0, 400)}`;
  }).join('\n\n');

  const sys = `당신은 Logisight 외부 고객용 월간 해운 리포트의 기사 에디터입니다. 아래 후보 기사는 이미 선정 자격(코어 매체 발 또는 교차보도 ≥2매체)을 통과한 목록입니다. 이 중 ${MONTH} 해운 시장에서 가장 중요한 ${N}건을 선정해 각각 한국어 피처 기사로 작성합니다.

규칙:
① 객관 중립 — 특정 기업(MTL 등)·영업 권유·독자 행동 지시("~하라/검토하라") 절대 금지.
② [현상]·[원인]·[배경]·[전망] 같은 라벨·머리표 금지 — 자연스럽게 이어지는 산문.
③ 명사·명사형으로 종결하되 '~임/~함/~됨/~해짐' 어미를 붙이지 말 것.
④ 후보 기사에 있는 사실만 사용(환각 금지). 수치엔 출처·단위.
⑤ JSON만 출력(설명·코드펜스 없이).
⑥ score(높을수록 중요)·cross(교차보도 매체 수)·CORE 표시를 참고해 중요도 판단. CORE 매체(Lloyd's List·Splash247·The Loadstar·Sea-Intelligence·JOC)를 우선 검토.
⑦ 선정 최대 ${N}건. 분량이 짧은(요약 200자 미만) 단신·인물·PR 기사는 피할 것.
각 기사 형식: { "idx": 후보번호(정수), "title": "한국어 헤드라인(간결·임팩트)", "subtitle": "한 줄 부제", "body": "2~3문단(문단 사이 \\n\\n), 각 문단 3~5문장" }
출력: {"articles":[ ... 최대 ${N}건 ... ]}`;

  const resp = await callDeepSeek({
    max_tokens: 4500, system: sys,
    messages: [{ role: 'user', content: `후보 기사:\n\n${list}\n\n위에서 최대 ${N}건 선정·작성. JSON만 출력.` }],
  });
  let txt = resp.content[0].text.replace(/```json|```/g, '').trim();
  let picked;
  try { picked = JSON.parse(txt).articles; }
  catch (e) { console.error('JSON 파싱 실패:', e.message); console.error(txt.slice(0, 400)); process.exit(1); }

  // Cap output
  picked = picked.slice(0, N);

  // ── OG 이미지 fetch + article data 구성 ──
  const articles = [];
  for (const a of picked) {
    const src     = items[a.idx] || {};
    const dataUri = src.url ? await fetchOgImage(src.url) : null;
    console.log(`  · ${a.title} — 이미지 ${dataUri ? 'OK' : '없음'}`);
    articles.push({
      title:    a.title,
      subtitle: a.subtitle,
      body:     a.body,
      img:      dataUri ? `<img class="feature-img" src="${dataUri}" alt="">\n\n` : '',
      source:   src.source || '',
      date:     src.published_at ? src.published_at.slice(0, 10) : '',
      short:    a.body.length < SHORT_BODY,
    });
  }

  // ── HTML 블록 조립 — 짧은 기사는 2-up 처리 ──
  const blocks = [];
  let i = 0;
  while (i < articles.length) {
    const a = articles[i];
    if (a.short && i + 1 < articles.length && articles[i + 1].short) {
      // Pair two short articles on one page to prevent blank pages
      const b       = articles[i + 1];
      const makeCard = x =>
        `<p class="article-cat">해운 시황</p>\n\n## ${x.title}\n\n#### ${x.subtitle}\n\n${x.img}${x.body}\n\n*출처: ${x.source}${x.date ? ` · ${x.date}` : ''}*`;
      blocks.push(
        `<div class="page-break"></div>\n\n<div class="two-up">\n\n${makeCard(a)}\n\n---\n\n${makeCard(b)}\n\n</div>`
      );
      i += 2;
    } else {
      blocks.push(
        `<div class="page-break"></div>\n\n<p class="article-cat">해운 시황</p>\n\n## ${a.title}\n\n#### ${a.subtitle}\n\n${a.img}${a.body}\n\n*출처: ${a.source}${a.date ? ` · ${a.date}` : ''}*`
      );
      i++;
    }
  }

  // ── 주요 해운 기사: 해운(02) 다음·항공(03) 앞에 삽입 ──
  const featured = `<div class="page-break"></div>\n\n# 주요 해운 기사\n\n${blocks.join('\n\n')}\n`;
  let draft = fs.readFileSync(DRAFT, 'utf-8');

  // 재실행 시 중복 방지
  if (/\n#{1,3}\s+주요\s*해운\s*기사/.test(draft)) {
    console.log('⚠️ draft에 이미 "주요 해운 기사"가 있음 — 삽입 건너뜀. 새로 넣으려면 assemble 먼저 재실행.');
    return;
  }

  const esc      = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const airTitle = (SECTIONS.find(s => s.id === 'air')   || {}).title || '항공 화물';
  const ocnTitle = (SECTIONS.find(s => s.id === 'ocean') || {}).title || '해운 시황';

  // 1순위: 항공 섹션 제목 바로 앞
  let m = draft.match(new RegExp('\\n#{1,3}\\s+' + esc(airTitle)));
  // 2순위: 항공 번호 헤딩 03.
  if (!m) m = draft.match(/\n#{1,3}\s+0?3\.\s[^\n]*/);

  if (m) {
    const at = draft.indexOf(m[0]) + 1;
    draft = draft.slice(0, at) + featured + '\n\n---\n\n' + draft.slice(at);
    fs.writeFileSync(DRAFT, draft, 'utf-8');
    console.log(`✅ 대표 기사 ${articles.length}건 — 항공 섹션 앞에 삽입`);
  } else {
    // 3순위: 해운 섹션 뒤 첫 구분선
    const om = draft.match(new RegExp('#{1,3}\\s+' + esc(ocnTitle)));
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
        console.log(`✅ 대표 기사 ${articles.length}건 — 해운 섹션 뒤에 삽입(폴백)`);
      }
    }
    if (!inserted) {
      fs.appendFileSync(DRAFT, `\n\n---\n\n${featured}`, 'utf-8');
      console.log(`⚠️ 항공/해운 섹션 위치 못 찾음 — 대표 기사 ${articles.length}건 맨 끝에 추가`);
    }
  }
}
main().catch(e => { console.error(e); process.exit(1); });
