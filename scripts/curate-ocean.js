// scripts/curate-ocean.js
// 해상 뉴스 AI 큐레이션
// 입력: content/drafts/latest-news.json (.shipping + .carrier_advisory + .risk)
// 출력: content/drafts/curated-ocean.json

const fs        = require('fs');
const path      = require('path');
const Anthropic = require('@anthropic-ai/sdk').default;

const NEWS_PATH   = path.resolve(__dirname, '../content/drafts/latest-news.json');
const OUT_PATH    = path.resolve(__dirname, '../content/drafts/curated-ocean.json');
const TODAY       = new Date().toISOString().slice(0, 10);

const windowArg  = process.argv.find(a => a.startsWith('--window='));
const windowDays = windowArg ? parseInt(windowArg.split('=')[1]) : 1;
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

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const itemList = items.map((i, idx) => {
    const hint = i.importance_hint === 'high' ? ' ⚡HIGH' : '';
    return `${idx + 1}. [${i.source}]${hint} ${i.title_en || i.title} — ${i.url}`;
  }).join('\n');

  const prompt = `당신은 MTL Shipping Agency의 해운 인텔리전스 에디터입니다.
한국·CIS·극동러시아 항로 특화 시각으로 평가합니다.
${portContext}

아래 뉴스 목록에서 MTL 화주·포워더에게 가장 중요한 3개를 선정하세요.

평가 기준:
+3: 한국↔유럽/미주/CIS 노선 직접 영향
+3: Blank Sailing / Void Sailing / Service Suspension 선사 공지
+2: 운임 수치 포함 (WCI·SCFI·FBX, $/FEU)
+2: Red Sea / Suez / Panama / Hormuz 실제 선박 인시던트 또는 항로 제한 (⚡HIGH 태그 우선)
+2: Surcharge 신설·인상 공지 (GRI·PSS·EFS)
+1: 항만 혼잡·대기 시간 정보
-2: 수상·인사 발표, M&A
-2: 미주·유럽 내부 이슈
-3: 광고성 자료
-3: 해운·물류·운임·항만·화물·무역과 직접 무관한 뉴스 (군사 성명, 외교 발표, 정치 뉴스 등)

⛔ 절대 제외 — 점수와 무관하게 선정 금지:
- 군사 작전 발표·부인·논평 (예: 해군 호위 재개 부인, 군사 성명)
- 외교 성명, 제재 협상, 정치적 선언 (운임·항로 직접 변동 없는 것)
- 선박 사고가 아닌 군사·테러 관련 뉴스 (물류 영향 없는 것)
- 해운·물류와 직접 관계 없는 에너지·환경·과학 뉴스
- 관련 기사가 3개 미만이면 links를 빈 배열로 줄여도 됨

Red Sea / Hormuz 선정 기준: 실제 선박 피격, 항로 변경 발효, 보험료 인상, TEU 운임 수치 포함된 경우만.
군사적 가능성·성명·부인만 있는 기사는 물류 영향 확정 전까지 제외.

출력 규칙 (엄격히 준수):
- main: 반드시 해운·운임·항만·물류 직접 관련 기사만.
- main.what: 200자 이하.
- main.why_now: 200자 이하.
- main.checkpoint: 200자 이하.
- links: 물류 관련 2번째, 3번째 뉴스만. 물류 무관 기사는 links에도 절대 포함 금지.
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

  const msg = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 2048,
    messages: [{ role: 'user', content: prompt }],
  });

  const raw = msg.content[0].text.trim();
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('Claude 응답에서 JSON 추출 실패');

  const result = JSON.parse(jsonMatch[0]);

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
