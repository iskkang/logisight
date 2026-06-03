'use strict';
// 무역·정책 뉴스 AI 큐레이션 (물류 규제·관세·공급망 정책)
// 입력: content/drafts/latest-news.json (.trade 배열)
// 출처: SupplyChainDive, TTNews, USTR, CBP, policy_eu, policy_imo
// 출력: content/drafts/curated-trade.json

const fs   = require('fs');
const path = require('path');
const { callDeepSeekJson } = require('../lib/deepseek');

const NEWS_PATH = path.resolve(__dirname, '../../content/drafts/latest-news.json');
const OUT_PATH  = path.resolve(__dirname, '../../content/drafts/curated-trade.json');
const TODAY     = new Date().toISOString().slice(0, 10);

const windowArg  = process.argv.find(a => a.startsWith('--window='));
const windowDays = windowArg ? parseInt(windowArg.split('=')[1]) : 3;
const cutoff     = new Date(Date.now() - windowDays * 86_400_000).toISOString();

function loadTradeItems() {
  if (!fs.existsSync(NEWS_PATH)) {
    console.warn('⚠️ latest-news.json 없음 — 스킵');
    process.exit(0);
  }
  const data  = JSON.parse(fs.readFileSync(NEWS_PATH, 'utf-8'));
  const items = (data.trade || []).filter(i => !i.published_at || i.published_at >= cutoff);
  const seen  = new Set();
  return items.filter(i => {
    if (!i.url || seen.has(i.url)) return false;
    seen.add(i.url);
    return true;
  });
}

async function curate(items) {
  if (items.length === 0) {
    console.warn('⚠️ trade 뉴스 0건 — 스킵');
    process.exit(0);
  }

  const itemList = items.map((i, idx) =>
    `${idx + 1}. [${i.source}] ${i.title_en || i.title} — ${i.url}`
  ).join('\n');

  const prompt = `당신은 MTL Shipping Agency의 무역·공급망 정책 인텔리전스 에디터입니다.
독자: 한국·중국·미주·러시아·CIS 노선 화물을 운영하는 화주·포워더·컴플라이언스 담당자.
커버리지 우선순위: ① 미·중 관세·통관 ② 한국 수출입 규제 ③ EU 무역정책 ④ IMO·환경규제 ⑤ 글로벌 공급망

아래 뉴스 목록에서 독자에게 실질적으로 중요한 3개를 선정하세요.

기본 평가 기준:
+5: 미국 IEEPA·Section 301/232·de minimis 관세 변동 (수치 포함)
+5: 중국발 화물 직접 타격 관세·통관 조치 발효·예고
+4: EU CBAM·반덤핑·무역방어조치 발효·시행
+4: IMO CII·탄소세·MARPOL 규제 발효·처벌 기준 변경
+4: 미국 CBP 통관 절차 변경 (HTS 코드·HS 재분류·집행 강화)
+3: WTO 분쟁·FTA 발효·개정 (한국 직접 영향)
+3: 공급망 재편 — 프렌드쇼어링·니어쇼어링 대형 발표 (수치 포함)
+2: 제재·수출통제 변경 (러시아·이란·북한 관련)
+1: 공급망 ESG·지속가능성 규제 동향
-2: 관세·물류 수치 없는 정치적 성명·선언
-3: 관련 무역 노선과 무관한 지역 이슈
-5: 물류·무역과 직접 무관한 뉴스

⛔ 절대 제외:
- 수치·시행일 없는 순수 정치 선언
- 물류 무관 기사
- 적격 기사 0개면 main.importance_score = 0, url = "" 으로 출력

출력 규칙 (엄격히 준수):
- main: 독자 실무에 가장 직결되는 기사. 없으면 importance_score=0.
- main.what: 200자 이하. 무슨 정책·규제가 어떻게 바뀌었나.
- main.why_now: 200자 이하. 화주·포워더 기준 왜 지금 중요한가.
- main.checkpoint: 200자 이하. 화주·포워더가 지금 해야 할 구체적 행동 1가지.
- links: 상위 2~3순위 뉴스만.
- MTL 영업 포인트는 출력하지 말 것.

뉴스 목록:
${itemList}

아래 JSON 형식으로만 응답하세요 (다른 텍스트 없이):
{
  "date": "${TODAY}",
  "curated_at": "${new Date().toISOString()}",
  "section": "trade",
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

  const result = await callDeepSeekJson({
    max_tokens: 8192,
    messages: [{ role: 'user', content: prompt }],
    debugPrefix: 'trade',
  });
  for (const field of ['what', 'why_now', 'checkpoint']) {
    if (result.main[field]?.length > 200) result.main[field] = result.main[field].slice(0, 197) + '…';
  }
  return result;
}

async function main() {
  const items = loadTradeItems();
  console.log(`📰 trade 뉴스 ${items.length}건 로드 (window: ${windowDays}d)`);

  const curated = await curate(items);
  fs.writeFileSync(OUT_PATH, JSON.stringify(curated, null, 2), 'utf-8');
  fs.writeFileSync(
    OUT_PATH.replace('curated-trade.json', `curated-trade-${TODAY}.json`),
    JSON.stringify(curated, null, 2), 'utf-8'
  );
  console.log(`✅ curated-trade.json 생성 완료 (main: ${curated.main?.title_ko})`);
}

main().catch(e => { console.error('❌ curate-trade 실패:', e.message); process.exit(1); });
