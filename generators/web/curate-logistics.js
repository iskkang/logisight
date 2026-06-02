'use strict';
// 글로벌 물류 대기업 뉴스 AI 큐레이션 (DHL·FedEx·UPS·DSV·K+N·DB Schenker 등)
// 입력: content/drafts/latest-news.json (.logistics 배열)
// 출력: content/drafts/curated-logistics.json

const fs   = require('fs');
const path = require('path');
const { callDeepSeek }    = require('../lib/deepseek');
const { parseJsonRobust } = require('../lib/parse-json');

const NEWS_PATH = path.resolve(__dirname, '../../content/drafts/latest-news.json');
const OUT_PATH  = path.resolve(__dirname, '../../content/drafts/curated-logistics.json');
const TODAY     = new Date().toISOString().slice(0, 10);

const windowArg  = process.argv.find(a => a.startsWith('--window='));
const windowDays = windowArg ? parseInt(windowArg.split('=')[1]) : 3;
const cutoff     = new Date(Date.now() - windowDays * 86_400_000).toISOString();

function loadLogisticsItems() {
  if (!fs.existsSync(NEWS_PATH)) {
    console.warn('⚠️ latest-news.json 없음 — 스킵');
    process.exit(0);
  }
  const data  = JSON.parse(fs.readFileSync(NEWS_PATH, 'utf-8'));
  const items = (data.logistics || []).filter(i => !i.published_at || i.published_at >= cutoff);
  const seen  = new Set();
  return items.filter(i => {
    if (!i.url || seen.has(i.url)) return false;
    seen.add(i.url);
    return true;
  });
}

async function curate(items) {
  if (items.length === 0) {
    console.warn('⚠️ logistics 뉴스 0건 — 스킵');
    process.exit(0);
  }

  const itemList = items.map((i, idx) =>
    `${idx + 1}. [${i.source}] ${i.title_en || i.title} — ${i.url}`
  ).join('\n');

  const prompt = `당신은 MTL Shipping Agency의 글로벌 물류 산업 인텔리전스 에디터입니다.
독자: 글로벌 물류 동향을 파악하려는 화주·포워더·물류 실무자.
커버리지 초점: DHL·FedEx·UPS·DSV·Kuehne+Nagel·DB Schenker·Flexport·CEVA·Bolloré 등 글로벌 물류 대기업 동향

아래 뉴스 목록에서 독자에게 실질적으로 중요한 3개를 선정하세요.

기본 평가 기준:
+5: 글로벌 물류 대기업의 요금·서비스 변경 (수치 포함)
+5: M&A·합병·인수·파트너십 발표 (시장 구조 변화 영향)
+4: 네트워크 확장/축소 — 노선 개설·폐지·거점 신설 (한국·중국·아시아 관련)
+4: 글로벌 물류 대기업의 AI·디지털 플랫폼·자동화 대규모 투자
+3: 공급망 서비스 혁신 — 가시성·트래킹·e-Fulfillment 솔루션 출시
+3: 대기업 실적 발표 (물동량·매출 수치 포함)
+2: 지속가능성·탄소중립 투자 발표 (구체 수치·목표 포함)
+2: 업계 요금 동향·창고비·라스트마일 배송비 변화
+1: 인사·조직 개편 (C-suite 이상)
-2: 수치 없는 MOU·협력 선언
-3: 소규모 지역 물류사 관련 (글로벌 영향 없는 것)
-5: 물류·공급망과 직접 무관한 뉴스

⛔ 절대 제외:
- 수치·영향 없는 순수 홍보 보도자료
- 물류 무관 기사
- 적격 기사 0개면 main.importance_score = 0, url = "" 으로 출력

출력 규칙 (엄격히 준수):
- main: 독자 실무에 가장 직결되는 기사. 없으면 importance_score=0.
- main.what: 200자 이하. 어떤 회사가 무엇을 발표했나.
- main.why_now: 200자 이하. 화주·포워더 기준 왜 지금 중요한가.
- main.checkpoint: 200자 이하. 화주·포워더가 참고해야 할 구체적 포인트 1가지.
- links: 상위 2~3순위 뉴스만.
- MTL 영업 포인트는 출력하지 말 것.

뉴스 목록:
${itemList}

아래 JSON 형식으로만 응답하세요 (다른 텍스트 없이):
{
  "date": "${TODAY}",
  "curated_at": "${new Date().toISOString()}",
  "section": "logistics",
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
  const items = loadLogisticsItems();
  console.log(`📰 logistics 뉴스 ${items.length}건 로드 (window: ${windowDays}d)`);

  const curated = await curate(items);
  fs.writeFileSync(OUT_PATH, JSON.stringify(curated, null, 2), 'utf-8');
  fs.writeFileSync(
    OUT_PATH.replace('curated-logistics.json', `curated-logistics-${TODAY}.json`),
    JSON.stringify(curated, null, 2), 'utf-8'
  );
  console.log(`✅ curated-logistics.json 생성 완료 (main: ${curated.main?.title_ko})`);
}

main().catch(e => { console.error('❌ curate-logistics 실패:', e.message); process.exit(1); });
