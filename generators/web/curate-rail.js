// scripts/curate-rail.js
// 철도 뉴스 AI 큐레이션
// 입력: content/drafts/latest-news.json (.rail 배열)
// 출력: content/drafts/curated-rail.json

const fs      = require('fs');
const path    = require('path');
const { callDeepSeek } = require('../lib/deepseek');

const NEWS_PATH   = path.resolve(__dirname, '../../content/drafts/latest-news.json');
const OUT_PATH    = path.resolve(__dirname, '../../content/drafts/curated-rail.json');
const TODAY       = new Date().toISOString().slice(0, 10);

// --window=7d 인수 확인
const windowArg = process.argv.find(a => a.startsWith('--window='));
const windowDays = windowArg ? parseInt(windowArg.split('=')[1]) : 3; // daily: 3일, weekly: --window=7d
const cutoff    = new Date(Date.now() - windowDays * 86_400_000).toISOString();

function loadRailItems() {
  if (!fs.existsSync(NEWS_PATH)) {
    console.warn('⚠️ latest-news.json 없음 — 스킵');
    process.exit(0);
  }
  const data = JSON.parse(fs.readFileSync(NEWS_PATH, 'utf-8'));
  const items = (data.rail || []).filter(i => {
    if (!i.published_at) return true; // 날짜 없으면 포함
    return i.published_at >= cutoff;
  });
  // 중복 URL dedup
  const seen = new Set();
  return items.filter(i => {
    if (!i.url || seen.has(i.url)) return false;
    seen.add(i.url);
    return true;
  });
}

async function curate(items) {
  if (items.length === 0) {
    console.warn('⚠️ rail 뉴스 0건 — 스킵');
    process.exit(0);
  }


  const itemList = items.map((i, idx) =>
    `${idx + 1}. [${i.source}] ${i.title_en || i.title} — ${i.url}`
  ).join('\n');

  const prompt = `당신은 MTL Shipping Agency의 철도 물류 인텔리전스 에디터입니다.
독자: 한국·중국·미주·러시아·CIS 노선 화물을 운영하는 화주·포워더.
커버리지 우선순위: ① 한국 ② 중국 ③ 미주 ④ 러시아 ⑤ CIS/중앙아시아

아래 뉴스 목록에서 독자에게 실질적으로 중요한 3개를 선정하세요.

지역별 가중치:
● 한국 관련 (+2 보너스): 한국 출발·도착, 부산·인천, KR-ANDIJAN/KR-ALMATY 등 한국 OD pair
● 중국 관련 (+1 보너스): 시안·청두·우한·이우 블록트레인, 중국-유럽 열차, 95306/CRCT 발표
● 미주 관련 (+0): CPKC·UP 등 북미 철도가 아시아 물류에 영향 주는 경우
● 러시아 관련 (+0): RZD 운행 변동, 제재 영향, TSR 서비스
● CIS 관련 (+0): 카자흐·우즈벡·키르기스 통과세·통관, KTZ·UTLC 발표

기본 평가 기준:
+5: TCR/TSR 운임 또는 지연 수치 변동 (구체적 $/TEU 또는 일수 포함)
+5: 한국↔중앙아시아/CIS/유럽 직통 노선 직접 영향 (스케줄·중단·우회)
+4: 중국-유럽 블록트레인 서비스 변경 (시안·청두·우한·이우 출발, TEU 수치 포함)
+4: 카자흐·우즈벡·키르기스 통과세·통관 절차 변화 (수치 포함)
+3: RZD 운행 변동·제재 적용 또는 TSR 구간 이슈
+3: INSTC/TITR/중간회랑 실질 운임·일정 변동 (수치 포함)
+2: BRI 노선 정책·인프라 개통 (물동량 또는 운임 수치 포함)
+1: 철도 물류 관련 지정학 변화 (노선에 간접 영향 있는 것)
-2: 수치 없는 외교 협력 선언·MOU·포럼 결과
-3: 아시아·CIS·미주 노선과 무관한 철도 이슈 (서유럽 내부, 아프리카, 남미)
-5: 물류·철도·운임·화물·무역과 직접 무관한 뉴스

⛔ 절대 제외:
- 운임·물동량·지연 수치가 전혀 없는 순수 외교 성명·정치 선언
- 물류 무관 기사 (시위, 우주탐사, 군사 작전, 선거, 스포츠)
- 관련 기사 3개 미만이면 links를 빈 배열로 줄여도 됨
- 적격 기사 0개면 main.importance_score = 0, url = "" 으로 출력

출력 규칙 (엄격히 준수):
- main: 독자 실무에 가장 직결되는 기사. 없으면 importance_score=0 으로 출력.
- main.what: 200자 이하. 무슨 일이 일어났나. 핵심 사실 1~2문장.
- main.why_now: 200자 이하. 화주·포워더 기준 왜 지금 중요한가 (지역 맥락 포함).
- main.checkpoint: 200자 이하. 화주·포워더가 지금 해야 할 구체적 행동 1가지.
- MTL 영업 포인트는 출력하지 말 것.
- links: 상위 2~3순위 뉴스만. 물류 무관 기사는 links에도 절대 포함 금지.

뉴스 목록:
${itemList}

아래 JSON 형식으로만 응답하세요 (다른 텍스트 없이):
{
  "date": "${TODAY}",
  "curated_at": "${new Date().toISOString()}",
  "section": "rail",
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

  const msg = await callDeepSeek({ max_tokens: 2048, messages: [{ role: 'user', content: prompt }] });

  const raw = msg.content[0].text.trim();
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('Claude 응답에서 JSON 추출 실패');

  const result = JSON.parse(jsonMatch[0]);

  // 200자 초과 필드 강제 단축
  for (const field of ['what', 'why_now', 'checkpoint']) {
    if (result.main[field] && result.main[field].length > 200) {
      result.main[field] = result.main[field].slice(0, 197) + '…';
    }
  }

  return result;
}

async function main() {
  const items = loadRailItems();
  console.log(`📰 rail 뉴스 ${items.length}건 로드 (window: ${windowDays}d)`);

  const curated = await curate(items);

  fs.writeFileSync(OUT_PATH, JSON.stringify(curated, null, 2), 'utf-8');
  // 날짜별 보존
  const archivePath = OUT_PATH.replace('curated-rail.json', `curated-rail-${TODAY}.json`);
  fs.writeFileSync(archivePath, JSON.stringify(curated, null, 2), 'utf-8');

  console.log(`✅ curated-rail.json 생성 완료 (main: ${curated.main?.title_ko})`);
}

main().catch(e => { console.error('❌ curate-rail 실패:', e.message); process.exit(1); });
