'use strict';
// generators/report/generate-monthly-analysis.js
// 월간 시장 인텔리전스 보고서 생성
// 입력: content/drafts/latest-news.json (category=carrier_update|deep_analysis 항목)
// 출력: content/drafts/monthly-analysis-YYYY-MM.md
// 실행: node generators/report/generate-monthly-analysis.js

const fs   = require('fs');
const path = require('path');

// 로컬 실행 시 .env.local 로드 (GitHub Actions는 env 블록으로 주입, 덮어쓰지 않음)
require('dotenv').config({ path: path.resolve(__dirname, '../../.env.local') });

const ANTHROPIC_KEY    = process.env.ANTHROPIC_API_KEY;
const NEWS_PATH        = path.resolve(__dirname, '../../content/drafts/latest-news.json');
const STYLE_GUIDE_PATH = path.resolve(__dirname, 'MONTHLY_REPORT_STYLE.md');
const OUTPUT_DIR       = path.resolve(__dirname, '../../content/drafts');
const TODAY            = new Date().toISOString().slice(0, 10);
const MONTH            = TODAY.slice(0, 7); // YYYY-MM

if (!ANTHROPIC_KEY) {
  console.error('ERROR: ANTHROPIC_API_KEY is not set.');
  process.exit(1);
}

function loadStyleGuide() {
  if (!fs.existsSync(STYLE_GUIDE_PATH)) {
    console.warn('⚠️ MONTHLY_REPORT_STYLE.md 없음 — 기본 톤으로 생성됨');
    return '';
  }
  return fs.readFileSync(STYLE_GUIDE_PATH, 'utf-8');
}

// category가 정확히 'deep_analysis' 또는 'carrier_update'인 항목만 추출.
// 'ocean_news' 같은 일간 뉴스 카테고리는 제외.
// title 10자 미만(메뉴·푸터 잡링크)도 제외.
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
  ].filter(i =>
    (i.category === 'deep_analysis' || i.category === 'carrier_update') &&
    i.source && i.url && i.title && i.title.length >= 10
  );

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

function buildSystemPrompt(styleGuide) {
  return `당신은 Logisight(MTL Shipping Agency)의 글로벌 해운·물류 시장 수석 분석가입니다.
독자: 한국 화주·포워더·MTL 영업팀 및 경영진.

# 문체·구조 규약 (반드시 준수)
아래 스타일 가이드를 100% 따릅니다. 특히 5대 불변 원칙을 절대 위반하지 마세요:
① 명사형 객관체 종결(~함/됨/임/전망/예상) — 경어체("습니다")·평서체("이다/했다") 금지
② 정량 비교(WoW/MoM/YoY + ▲▼) — 수치엔 항상 단위·비교 기준
③ 현상→원인→배경→전망 4단 논리 — 사실 나열로 끝내지 말 것
④ 각 분석 블록 끝에 ☞ 또는 ➔ 시사점(So what)으로 마무리
⑤ 모든 수치·인용에 출처(기관/날짜) 명기

--- 스타일 가이드 시작 ---
${styleGuide}
--- 스타일 가이드 끝 ---

# 데이터 사용 원칙 (환각 방지 — 최우선)
1. 제공된 기사 제목·요약에 **명시된 사실만** 사용. 출처에 없는 수치·운임값·% 절대 생성 금지.
2. 운임 지수 수치(SCFI/WCI/FBX 등)는 이 입력에 포함되지 않음 → "구체 수치는 Logisight 지표 대시보드 참조"로 처리하고 임의 숫자 쓰지 말 것.
3. 근거가 약하거나 추정인 내용은 [Logisight 분석] 마커 + (추정) 표기.
4. 물류·해운·공급망과 무관한 기사는 제외.
5. 입력 기사가 적으면 무리하게 분량을 늘리지 말 것 — 있는 기사 기반으로만.

# 출력 형식 (Markdown, 한국어, 스타일 가이드 톤)

# Logisight 월간 시장 인텔리전스 — {분석월}

> 수집일 {수집일} | 소스: JOC {N}건, Freightos {N}건, Flexport {N}건

**[이번 달 핵심]** (현상 + 원인·맥락 + 전망을 한 문장, 말줄임표로 연결, 명사형 종결)

---

## 01. 해운 시황 종합

**[현상]**
- (수집된 기사가 전하는 시장 방향·이슈, 명사형 종결, 출처 병기)

**[원인]**
- (직접 동인)

**[배경]**
- (구조적·지정학 맥락: 홍해/중동/얼라이언스 재편 등, 기사에 언급된 범위 내)

**[전망]**
- 단기(1개월):
- 중기(2~3개월):
☞ (한국 화주·포워더 관점 함의 + 대응 방향)

---

## 02. 주요 이슈 (상위 3건)

### [이슈 제목] (출처, 날짜)
**[현상]** 1~2문장, 명사형 종결
**[원인]** 핵심 동인 1가지
➔ **[시사점]** 한국 화주·포워더 실무 관점 행동 1가지

(상위 3건 반복)

---

## 03. 다음 달 주요 변수
- 변수 1:
- 변수 2:
- 변수 3:
※ (모니터링 필요 잔여 리스크)

---
*본 리포트는 공개 출처 기반 분석이며, 운임 구체 수치는 Logisight 지표 대시보드를 참조 바람. 무단 전재 금지.*`;
}

async function main() {
  const items = loadMonthlyItems();
  if (items.length === 0) {
    console.warn('⚠️ monthly_source 데이터 없음 — npm run collect:monthly 를 먼저 실행하세요.');
    process.exit(0);
  }

  const deep    = items.filter(i => i.category === 'deep_analysis');
  const carrier = items.filter(i => i.category === 'carrier_update');

  // 소스별 카운트 (헤더·프롬프트용)
  const countBy = (name) => items.filter(i => (i.source || '').includes(name)).length;
  const jocN  = countBy('JOC');
  const fxN   = countBy('Freightos');
  const flexN = countBy('Flexport');
  console.log(`📊 monthly ${items.length}건 (deep ${deep.length} / carrier ${carrier.length}) — JOC ${jocN}, Freightos ${fxN}, Flexport ${flexN}`);

  const styleGuide   = loadStyleGuide();
  const systemPrompt = buildSystemPrompt(styleGuide);
  const userPrompt   = buildUserPrompt(items);

  const Anthropic = require('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: ANTHROPIC_KEY });

  console.log(`Claude 분석 생성 중 (${MONTH})...`);
  const msg = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4000,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  });

  const text = msg.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
  if (!text) {
    console.error('❌ Claude 응답이 비어 있습니다.');
    process.exit(1);
  }

  const header = [
    `<!-- generated: ${new Date().toISOString()} by generate-monthly-analysis.js -->`,
    `<!-- sources: JOC ${jocN}, Freightos ${fxN}, Flexport ${flexN} -->`,
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
