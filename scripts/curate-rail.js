// scripts/curate-rail.js
// 철도 뉴스 AI 큐레이션
// 입력: content/drafts/latest-news.json (.rail 배열)
// 출력: content/drafts/curated-rail.json

const fs      = require('fs');
const path    = require('path');
const Anthropic = require('@anthropic-ai/sdk').default;

const NEWS_PATH   = path.resolve(__dirname, '../content/drafts/latest-news.json');
const OUT_PATH    = path.resolve(__dirname, '../content/drafts/curated-rail.json');
const TODAY       = new Date().toISOString().slice(0, 10);

// --window=7d 인수 확인
const windowArg = process.argv.find(a => a.startsWith('--window='));
const windowDays = windowArg ? parseInt(windowArg.split('=')[1]) : 1;
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

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const itemList = items.map((i, idx) =>
    `${idx + 1}. [${i.source}] ${i.title_en || i.title} — ${i.url}`
  ).join('\n');

  const prompt = `당신은 MTL Shipping Agency의 물류 인텔리전스 에디터입니다.
한국·CIS·중앙아시아 특화 시각으로 철도 뉴스를 평가합니다.

아래 뉴스 목록에서 MTL 화주·포워더에게 가장 중요한 3개를 선정하세요.

평가 기준:
+3: 한국↔CIS/중앙아시아 노선 직접 영향 (KR-ANDIJAN, KR-ALMATY, TCR/TSR)
+2: 구체적 수치 포함 (운임·물동량·지연일수·TEU)
+2: MTL 핵심 서비스 직결 (TCR/TSR/INSTC/중유럽반열)
+1: 지정학·정책 변화 (러시아 제재, 카자흐 통과세, 중국 운임정책)
-2: 단순 수상·인사 발표
-3: 철도·물류·운임·항만·화물·무역과 직접 무관한 뉴스 (시위, 우주탐사, 스포츠, 선거, 군사작전 등)

⛔ 절대 제외 — 점수와 무관하게 선정 금지:
- 물류·철도·운임·화물·항만·무역과 관련 없는 정치·사회·과학 뉴스
- 예: 시위, 우주 탐사, 군사 충돌, 스포츠, 선거, 외교 성명
- 관련 기사가 3개 미만이면 부족한 만큼 links를 빈 배열로 줄여도 됨

출력 규칙 (엄격히 준수):
- main: 반드시 물류·운임·철도·항만 직접 관련 기사만. 없으면 가장 간접적으로라도 관련된 것.
- main.what: 200자 이하. 무슨 일이 일어났나. 핵심 사실 1~2문장.
- main.why_now: 200자 이하. 왜 지금 중요한가. 1~2문장.
- main.checkpoint: 200자 이하. 화주·포워더가 지금 할 일 1가지.
- MTL 영업 포인트는 출력하지 말 것.
- links: 물류 관련 2번째, 3번째 뉴스만. 물류 무관 기사는 links에도 절대 포함 금지.

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

  const msg = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 2048,
    messages: [{ role: 'user', content: prompt }],
  });

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
