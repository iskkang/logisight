'use strict';
// 항공화물 뉴스 AI 큐레이션
// 입력: content/drafts/latest-news.json (.air 배열)
// 출력: content/drafts/curated-air.json

const fs   = require('fs');
const path = require('path');
const { callDeepSeek }    = require('../lib/deepseek');
const { parseJsonRobust } = require('../lib/parse-json');

const NEWS_PATH = path.resolve(__dirname, '../../content/drafts/latest-news.json');
const OUT_PATH  = path.resolve(__dirname, '../../content/drafts/curated-air.json');
const TODAY     = new Date().toISOString().slice(0, 10);

const windowArg  = process.argv.find(a => a.startsWith('--window='));
const windowDays = windowArg ? parseInt(windowArg.split('=')[1]) : 3;
const cutoff     = new Date(Date.now() - windowDays * 86_400_000).toISOString();

function loadAirItems() {
  if (!fs.existsSync(NEWS_PATH)) {
    console.warn('⚠️ latest-news.json 없음 — 스킵');
    process.exit(0);
  }
  const data  = JSON.parse(fs.readFileSync(NEWS_PATH, 'utf-8'));
  const items = (data.air || []).filter(i => !i.published_at || i.published_at >= cutoff);
  const seen  = new Set();
  return items.filter(i => {
    if (!i.url || seen.has(i.url)) return false;
    seen.add(i.url);
    return true;
  });
}

async function curate(items) {
  if (items.length === 0) {
    console.warn('⚠️ air 뉴스 0건 — 스킵');
    process.exit(0);
  }

  const itemList = items.map((i, idx) =>
    `${idx + 1}. [${i.source}] ${i.title_en || i.title} — ${i.url}`
  ).join('\n');

  const prompt = `당신은 MTL Shipping Agency의 항공화물 인텔리전스 에디터입니다.
독자: 한국·중국·미주·러시아·CIS 노선 항공화물을 이용하는 화주·포워더.
커버리지 우선순위: ① 한국 ② 중국 ③ 미주 ④ 유럽 ⑤ 중동

아래 뉴스 목록에서 독자에게 실질적으로 중요한 3개를 선정하세요.

기본 평가 기준:
+5: 항공화물 운임 수치(BAI·TAC·WorldACD·$/kg) 포함 등락 기사
+5: 한국발(ICN/GMP) 또는 중국발(PVG/PEK/CAN) 직접 영향 노선 서비스 변경·중단
+4: 항공기 복화(belly) 공급 변화 — 여객 스케줄·항공사 기단 변동
+4: 전자상거래 특수(알리·테무·쉬인) 수요 급증·급감
+3: 공항 혼잡·게이트 대기·지연 수치 포함 기사 (인천·상하이·홍콩·두바이)
+3: 특수화물 규제 변경 (리튬배터리·의약품·위험물 DGR)
+2: 항공사 실적·화물 전략 발표 (대한항공·아시아나·CX·EK·FX)
+1: 항공 물동량 지수·성장률 통계 발표
-2: 여객 노선·마일리지 관련 일반 기사
-3: 항공화물과 무관한 군사·외교·정치 뉴스
-5: 물류·항공과 직접 무관한 뉴스

⛔ 절대 제외:
- 운임·물동량·지연 수치 없는 외교 협력 선언
- 물류 무관 기사
- 적격 기사 0개면 main.importance_score = 0, url = "" 으로 출력

출력 규칙 (엄격히 준수):
- main: 독자 실무에 가장 직결되는 기사. 없으면 importance_score=0.
- main.what: 200자 이하. 무슨 일이 일어났나.
- main.why_now: 200자 이하. 화주·포워더 기준 왜 지금 중요한가.
- main.checkpoint: 200자 이하. 화주·포워더가 지금 해야 할 구체적 행동 1가지.
- links: 상위 2~3순위 뉴스만. 물류 무관 기사는 links에도 절대 포함 금지.
- MTL 영업 포인트는 출력하지 말 것.

뉴스 목록:
${itemList}

아래 JSON 형식으로만 응답하세요 (다른 텍스트 없이):
{
  "date": "${TODAY}",
  "curated_at": "${new Date().toISOString()}",
  "section": "air",
  "main": {
    "title": "영어 제목",
    "title_ko": "한국어 제목",
    "url": "원본 URL",
    "source": "출처명",
    "image_url": null,
    "what": "200자 이하",
    "why_now": "200자 이하",
    "checkpoint": "200자 이하",
    "importance_score": 7
  },
  "links": [
    { "title": "영어 제목2", "title_ko": "한국어 제목2", "url": "URL2", "source": "출처2" },
    { "title": "영어 제목3", "title_ko": "한국어 제목3", "url": "URL3", "source": "출처3" }
  ],
  "total_collected": ${items.length},
  "excluded_count": ${Math.max(0, items.length - 3)}
}`;

  const msg = await callDeepSeek({
    max_tokens: 2048,
    responseFormat: { type: 'json_object' },
    messages: [{ role: 'user', content: prompt }],
  });
  const raw = msg.content[0].text.trim();
  const result = parseJsonRobust(raw);
  if (!result) {
    console.error('❌ DeepSeek 응답 원본 (앞 500자):', raw.slice(0, 500));
    throw new Error('DeepSeek 응답에서 JSON 추출 실패');
  }
  for (const field of ['what', 'why_now', 'checkpoint']) {
    if (result.main[field]?.length > 200) result.main[field] = result.main[field].slice(0, 197) + '…';
  }
  return result;
}

async function main() {
  const items = loadAirItems();
  console.log(`📰 air 뉴스 ${items.length}건 로드 (window: ${windowDays}d)`);

  const curated = await curate(items);
  fs.writeFileSync(OUT_PATH, JSON.stringify(curated, null, 2), 'utf-8');
  fs.writeFileSync(
    OUT_PATH.replace('curated-air.json', `curated-air-${TODAY}.json`),
    JSON.stringify(curated, null, 2), 'utf-8'
  );
  console.log(`✅ curated-air.json 생성 완료 (main: ${curated.main?.title_ko})`);
}

main().catch(e => { console.error('❌ curate-air 실패:', e.message); process.exit(1); });
