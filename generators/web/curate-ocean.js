// scripts/curate-ocean.js
// 해상 뉴스 AI 큐레이션
// 입력: content/drafts/latest-news.json (.shipping + .carrier_advisory + .risk)
// 출력: content/drafts/curated-ocean.json

const fs        = require('fs');
const path      = require('path');
const { callDeepSeekJson } = require('../lib/deepseek');

const NEWS_PATH   = path.resolve(__dirname, '../../content/drafts/latest-news.json');
const OUT_PATH    = path.resolve(__dirname, '../../content/drafts/curated-ocean.json');
const TODAY       = new Date().toISOString().slice(0, 10);

const windowArg  = process.argv.find(a => a.startsWith('--window='));
const windowDays = windowArg ? parseInt(windowArg.split('=')[1]) : 3; // daily: 3일, weekly: --window=7d
const cutoff     = new Date(Date.now() - windowDays * 86_400_000).toISOString();

function loadOceanItems() {
  if (!fs.existsSync(NEWS_PATH)) {
    console.warn('⚠️ latest-news.json 없음 — 스킵');
    process.exit(0);
  }
  const data = JSON.parse(fs.readFileSync(NEWS_PATH, 'utf-8'));

  // shipping + carrier_advisory + risk 합산
  const allItems = [
    ...(data.shipping         || []),
    ...(data.carrier_advisory || []),
    ...(data.risk             || []),
  ].filter(i => !i.published_at || i.published_at >= cutoff);

  // 중복 URL dedup
  const seen = new Set();
  return allItems.filter(i => {
    if (!i.url || seen.has(i.url)) return false;
    seen.add(i.url);
    return true;
  });
}

// Supabase에서 port_throughput 최근 2개월 로드 (선택적)
async function loadPortContext() {
  const url     = process.env.SUPABASE_URL;
  const svcKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !svcKey) return '';
  try {
    const { createClient } = require('@supabase/supabase-js');
    const sb = createClient(url, svcKey);
    const twoMonthsAgo = new Date();
    twoMonthsAgo.setMonth(twoMonthsAgo.getMonth() - 2);
    const { data } = await sb
      .from('port_throughput')
      .select('port_code,year,month,teu')
      .gte('year', twoMonthsAgo.getFullYear())
      .order('year', { ascending: false })
      .order('month', { ascending: false })
      .limit(10);
    if (!data || data.length === 0) return '';
    return '\n[항만 최신 통계]\n' + data
      .map(r => `- ${r.port_code}: ${r.year}-${String(r.month).padStart(2, '0')} = ${r.teu?.toLocaleString() || 'N/A'} TEU`)
      .join('\n');
  } catch {
    return '';
  }
}

async function curate(items, portContext) {
  if (items.length === 0) {
    console.warn('⚠️ ocean 뉴스 0건 — 스킵');
    process.exit(0);
  }


  const itemList = items.map((i, idx) => {
    const hint = i.importance_hint === 'high' ? ' ⚡HIGH' : '';
    return `${idx + 1}. [${i.source}]${hint} ${i.title_en || i.title} — ${i.url}`;
  }).join('\n');

  const prompt = `당신은 MTL Shipping Agency의 해운 인텔리전스 에디터입니다.
독자: 한국·중국·미주·러시아·CIS 노선 화물을 운영하는 화주·포워더.
커버리지 우선순위: ① 한국 ② 중국 ③ 미주 ④ 러시아 ⑤ CIS
${portContext}

아래 뉴스 목록에서 독자에게 실질적으로 중요한 3개를 선정하세요.

지역별 가중치:
● 한국 관련 (+2 보너스): 부산·인천·광양 출발/도착, HMM, 한국 기항 서비스, KCCI
● 중국 관련 (+1 보너스): 상하이·닝보·칭다오·선전 출발, SCFI, 중국 선사(COSCO·Yang Ming)
● 미주 관련 (+1 보너스): LA·LB·시애틀 항만, 미주 서안 노선 운임·파업·혼잡
● 러시아 관련 (+0): 블라디보스토크·보스토치니, 러시아 항만 제재·운영 이슈
● CIS 관련 (+0): 카자흐 카스피해 노선, 아제르바이잔 항만

기본 평가 기준:
+5: Blank Sailing / Void Sailing 공지 (⚡HIGH 태그, 한국·중국 기항 서비스)
+5: 운임 수치 포함 (WCI·SCFI·KCCI·FBX, $/FEU 구체 수치)
+4: 선사 서비스 변경·신설·종료 공지 (Maersk·MSC·CMA·ONE·HMM·COSCO 등)
+4: 미주 서안 항만 파업·혼잡·대기 이슈 (한국·중국발 주력 노선)
+3: GRI·PSS·EFS·BAF 등 Surcharge 신설·인상 공지
+3: 주요 환적 허브(싱가포르·포트클랑·상하이) 혼잡·대기 급증
+2: Red Sea/Suez/Panama 실제 통항 제한·우회 발효 (운임 수치 포함)
+1: 글로벌 운임 지수 동향 (수치 포함, 간접 영향 있는 것)
-2: 항만·선사와 무관한 기업 M&A·수상·인사 발표
-3: 군사 성명·발표·부인 (직접 항로 제한·운임 영향 없는 것)
-3: ① ~ ⑤ 노선 모두와 무관한 지역 이슈 (대서양 항로, 아프리카 내수)
-5: 해운·물류와 직접 무관한 뉴스

⛔ 절대 제외:
- 군사 발표·부인 (미 해군 성명, 군사 작전 논평 등)
- 물류 수치(운임·일정·TEU) 없는 외교·정치 기사
- 관련 기사 3개 미만이면 links를 빈 배열로 줄여도 됨
- 적격 기사 0개면 main.importance_score = 0, url = "" 으로 출력

Red Sea/Hormuz/Panama: 실제 통항 제한·우회 운임 수치 확인된 경우만 선정.
단순 군사 동향이나 인근 인시던트만으로는 선정 금지.

출력 규칙 (엄격히 준수):
- main: 독자 실무에 가장 직결되는 기사. 없으면 importance_score=0 으로 출력.
- main.what: 200자 이하. 무슨 일이 일어났나.
- main.why_now: 200자 이하. 화주·포워더 기준 왜 지금 중요한가 (지역 맥락 포함).
- main.checkpoint: 200자 이하. 화주·포워더가 지금 해야 할 구체적 행동 1가지.
- links: 상위 2~3순위 뉴스만. 물류 무관 기사는 links에도 절대 포함 금지.
- MTL 영업 포인트는 출력하지 말 것.

뉴스 목록:
${itemList}

아래 JSON 형식으로만 응답하세요:
{
  "date": "${TODAY}",
  "curated_at": "${new Date().toISOString()}",
  "section": "ocean",
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
    debugPrefix: 'ocean',
  });

  for (const field of ['what', 'why_now', 'checkpoint']) {
    if (result.main[field] && result.main[field].length > 200) {
      result.main[field] = result.main[field].slice(0, 197) + '…';
    }
  }

  return result;
}

async function main() {
  const items      = loadOceanItems();
  const portCtx    = await loadPortContext();
  console.log(`📰 ocean 뉴스 ${items.length}건 로드 (window: ${windowDays}d)`);

  const curated = await curate(items, portCtx);

  fs.writeFileSync(OUT_PATH, JSON.stringify(curated, null, 2), 'utf-8');
  const archivePath = OUT_PATH.replace('curated-ocean.json', `curated-ocean-${TODAY}.json`);
  fs.writeFileSync(archivePath, JSON.stringify(curated, null, 2), 'utf-8');

  console.log(`✅ curated-ocean.json 생성 완료 (main: ${curated.main?.title_ko})`);
}

main().catch(e => { console.error('❌ curate-ocean 실패:', e.message); process.exit(1); });
