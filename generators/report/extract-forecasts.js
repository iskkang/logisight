'use strict';
// generators/report/extract-forecasts.js
// 월간 리포트 섹션 본문에서 전망(forward-looking) 문장을 추출해 forecasts.json에 저장.
// 다음 달 스코어카드(T4)가 실제 지수와 대조 판정하는 시드 데이터.
// 사용법: node extract-forecasts.js --month=2026-07

const path = require('path');
const fs   = require('fs');

const { callDeepSeekJson } = require('../lib/deepseek');
const { parseFrontmatter } = require('./lib/section-runner');
const { saveForecasts }    = require('./lib/forecast-store');
const SECTIONS = require('./sections.config');

const CONTENT_DIR      = path.resolve(__dirname, '../../content/monthly-report');
const VALID_METRICS    = ['SCFI', 'KCCI', 'CCFI', 'WCI', 'BDI'];
const VALID_DIRECTIONS = ['up', 'down', 'flat'];
const MAX_PER_SECTION  = 3;

function loadSectionBodies(month) {
  const bodies = [];
  for (const sec of SECTIONS) {
    const p = path.join(CONTENT_DIR, month, `${sec.id}.md`);
    if (!fs.existsSync(p)) continue;
    const { body } = parseFrontmatter(fs.readFileSync(p, 'utf-8'));
    if (body.trim()) bodies.push({ id: sec.id, title: sec.title, body: body.trim() });
  }
  return bodies;
}

function buildPrompt(sections) {
  const sectionsText = sections.map(s => `## [${s.id}] ${s.title}\n${s.body}`).join('\n\n');
  const idList = sections.map(s => s.id).join(', ');
  return `아래는 월간 물류 리포트의 섹션별 본문입니다. 각 섹션에서 미래 전망(forward-looking) 성격의 문장을 최대 ${MAX_PER_SECTION}건씩 골라 원문 그대로 추출하세요.

각 클레임은 다음 스키마를 따르는 JSON 객체입니다:
{ "section": "<섹션 id>", "claim": "<원문 문장 그대로>", "metric": "SCFI"|"KCCI"|"CCFI"|"WCI"|"BDI"|null, "direction": "up"|"down"|"flat"|null, "horizon": "M+1" }

- section 필드에는 반드시 각 섹션 제목 앞 대괄호 안의 id만 정확히 그대로 쓰세요(제목 텍스트 금지). 유효한 id 목록: ${idList}.
- claim은 본문에서 그대로 가져온 문장(요약·재작성 금지).
- metric은 클레임이 명확히 특정 지수(SCFI/KCCI/CCFI/WCI/BDI) 하나에 대한 것일 때만 채우고, 그 외(정성적 전망, 복수 지수, 지수 무관)는 null.
- direction은 상승 전망이면 "up", 하락 전망이면 "down", 보합·횡보 전망이면 "flat", 판단 불가면 null.
- horizon은 항상 "M+1".
- 전망 문장이 없는 섹션은 건너뜀.

출력은 반드시 다음 형식의 JSON 객체만: { "claims": [ ... ] }

섹션 본문:
${sectionsText}`;
}

// LLM이 id 대신 섹션 제목을 돌려주는 경우를 대비한 방어적 매핑(id/title → id)
function resolveSectionId(value, idByLabel) {
  if (typeof value !== 'string') return null;
  return idByLabel.get(value.trim()) || null;
}

function sanitizeClaims(raw, idByLabel) {
  if (!Array.isArray(raw)) return [];
  const perSectionCount = {};
  const out = [];
  for (const c of raw) {
    if (!c || typeof c !== 'object') continue;
    if (typeof c.claim !== 'string' || !c.claim.trim()) continue;
    const sectionId = resolveSectionId(c.section, idByLabel);
    if (!sectionId) continue;
    perSectionCount[sectionId] = perSectionCount[sectionId] || 0;
    if (perSectionCount[sectionId] >= MAX_PER_SECTION) continue;
    perSectionCount[sectionId]++;
    out.push({
      section:   sectionId,
      claim:     c.claim.trim(),
      metric:    VALID_METRICS.includes(c.metric) ? c.metric : null,
      direction: VALID_DIRECTIONS.includes(c.direction) ? c.direction : null,
      horizon:   'M+1',
    });
  }
  return out;
}

async function main() {
  const monthArg = process.argv.find(a => a.startsWith('--month='));
  const month    = monthArg ? monthArg.split('=')[1] : null;
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    console.error('사용법: node extract-forecasts.js --month=YYYY-MM');
    process.exit(1);
  }

  if (!process.env.DEEPSEEK_API_KEY) {
    console.warn('⚠️  DEEPSEEK_API_KEY 미설정 — 전망 추출 스킵');
    process.exit(0);
  }

  const sections = loadSectionBodies(month);
  if (sections.length === 0) {
    console.warn(`⚠️  ${month} 섹션 파일 없음 — 전망 추출 스킵`);
    process.exit(0);
  }
  const idByLabel = new Map();
  for (const s of sections) { idByLabel.set(s.id, s.id); idByLabel.set(s.title, s.id); }

  let result;
  try {
    result = await callDeepSeekJson({
      max_tokens:  4096,
      messages:    [{ role: 'user', content: buildPrompt(sections) }],
      debugPrefix: 'forecasts',
    });
  } catch (e) {
    console.warn('⚠️  전망 추출 LLM 호출 실패 — forecasts.json 미기록:', e.message);
    process.exit(0);
  }

  const claims = sanitizeClaims(result && result.claims, idByLabel);
  if (claims.length === 0) {
    console.warn('⚠️  추출된 전망 클레임 없음 — forecasts.json 미기록');
    process.exit(0);
  }

  const filePath = saveForecasts(month, claims);
  console.log(`✅ 전망 ${claims.length}건 저장: ${filePath}`);
}

main().catch(err => {
  console.warn('⚠️  extract-forecasts.js 실패(무시):', err.message);
  process.exit(0);
});
