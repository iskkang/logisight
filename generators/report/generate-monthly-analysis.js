'use strict';
// generators/report/generate-monthly-analysis.js
// 월간 시장 인텔리전스 보고서 생성
// 입력: content/drafts/latest-news.json (monthly_source items — category 필드 있는 것)
// 출력: content/drafts/monthly-analysis-YYYY-MM.md
// 실행: node generators/report/generate-monthly-analysis.js

const fs   = require('fs');
const path = require('path');

// 로컬 실행 시 .env.local 로드 (GitHub Actions는 env 블록으로 주입, 덮어쓰지 않음)
require('dotenv').config({ path: path.resolve(__dirname, '../../.env.local') });

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const NEWS_PATH     = path.resolve(__dirname, '../../content/drafts/latest-news.json');
const OUTPUT_DIR    = path.resolve(__dirname, '../../content/drafts');
const TODAY         = new Date().toISOString().slice(0, 10);
const MONTH         = TODAY.slice(0, 7); // YYYY-MM

if (!ANTHROPIC_KEY) {
  console.error('ERROR: ANTHROPIC_API_KEY is not set.');
  process.exit(1);
}

// latest-news.json에서 monthly_source 항목만 추출 (category 필드 존재 여부로 구분)
function loadMonthlyItems() {
  if (!fs.existsSync(NEWS_PATH)) {
    console.error('ERROR: latest-news.json 없음 — npm run collect:monthly 먼저 실행하세요.');
    process.exit(1);
  }
  const data = JSON.parse(fs.readFileSync(NEWS_PATH, 'utf-8'));
  const all = [
    ...(data.shipping || []),
    ...(data.rail     || []),
    ...(data.trade    || []),
  ].filter(i => i.category && i.source && i.url && i.title);

  // URL dedup
  const seen = new Set();
  return all.filter(i => {
    if (seen.has(i.url)) return false;
    seen.add(i.url);
    return true;
  });
}

function buildUserPrompt(items) {
  const deep    = items.filter(i => i.category === 'deep_analysis');
  const carrier = items.filter(i => i.category === 'carrier_update');

  const lines = [];
  lines.push(`분석 기준월: ${MONTH}`);
  lines.push(`수집일: ${TODAY}`);
  lines.push('');

  if (carrier.length > 0) {
    lines.push(`## 운임·시황 업데이트 (${carrier.length}건)`);
    for (const item of carrier) {
      lines.push(`- [${item.source}] ${item.title} — ${item.url}`);
    }
    lines.push('');
  }

  if (deep.length > 0) {
    lines.push(`## 심층 분석 기사 (${deep.length}건)`);
    for (const item of deep) {
      const summary = item.summary_en ? ` — 요약: ${item.summary_en.slice(0, 180)}` : '';
      lines.push(`- [${item.source}] ${item.title}${summary}`);
      lines.push(`  URL: ${item.url}`);
    }
    lines.push('');
  }

  lines.push('위 기사들을 바탕으로 월간 인텔리전스 보고서를 작성해주세요.');
  return lines.join('\n');
}

const SYSTEM_PROMPT = `당신은 Logisight의 글로벌 해운·물류 시장 분석가입니다.
독자: 한국 화주, 포워더, MTL Shipping Agency 영업팀.

분석 원칙:
1. 제공된 기사·요약에 명시된 사실만 사용. 출처 없는 수치 사용 금지.
2. 수치가 없는 항목은 "데이터 미수집"으로 표시 — 임의 추정 금지.
3. 자체 분석·의견은 "[Logisight 분석]" 마커로 명시.
4. 물류·해운·공급망 무관 기사는 제외.

출력 형식 (Markdown, 한국어):

# 월간 인텔리전스 리포트 — {YYYY-MM}
> 수집일: {TODAY} | 소스: JOC {N}건, Freightos {N}건

---

## 1. 컨테이너 운임 동향

**[현상]**
- 운임 수치 및 추세 (출처: 기관명, 날짜)

**[원인]**
- 원인 1:
- 원인 2:

**[전망]**
- 단기 (1개월):
- 중기 (2~3개월):
- 핵심 변수:

---

## 2. 주요 이슈 (상위 3건)

각 이슈를 아래 형식으로:

### 이슈 제목 (출처)
**[현상]** 1~2문장
**[원인]** 핵심 원인 1가지
**[시사점]** 한국 화주·포워더 관점에서 실무 행동 1가지

---

## 3. 다음 달 주요 변수
- 변수 1:
- 변수 2:
- 변수 3:`;

async function main() {
  const items = loadMonthlyItems();

  if (items.length === 0) {
    console.warn('⚠️ monthly_source 데이터 없음 — npm run collect:monthly 를 먼저 실행하세요.');
    process.exit(0);
  }

  const deep    = items.filter(i => i.category === 'deep_analysis');
  const carrier = items.filter(i => i.category === 'carrier_update');
  console.log(`📊 monthly 소스 ${items.length}건 로드 (deep_analysis: ${deep.length}건, carrier_update: ${carrier.length}건)`);

  const userPrompt = buildUserPrompt(items);

  const Anthropic = require('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: ANTHROPIC_KEY });

  console.log(`Claude 분석 생성 중 (${MONTH})...`);
  const msg = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 3000,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPrompt }],
  });

  const text = msg.content[0]?.type === 'text' ? msg.content[0].text : '';
  if (!text) {
    console.error('❌ Claude 응답이 비어 있습니다.');
    process.exit(1);
  }

  const header = [
    `<!-- generated: ${new Date().toISOString()} by generate-monthly-analysis.js -->`,
    `<!-- sources: JOC ${deep.length}건, Freightos ${carrier.length}건 -->`,
    '',
  ].join('\n');

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const outPath = path.join(OUTPUT_DIR, `monthly-analysis-${MONTH}.md`);
  fs.writeFileSync(outPath, header + text + '\n', 'utf-8');

  console.log(`✅ 월간 분석 완료: ${outPath}`);
}

main().catch(err => {
  console.error('❌ generate-monthly-analysis.js 실패:', err.message);
  process.exit(1);
});
