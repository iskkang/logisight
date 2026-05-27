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

  const prompt = `당신은 MTL Shipping Agency의 한국 해운 인텔리전스 에디터입니다.
독자: 부산·인천·광양 출발 화물을 운영하는 한국 화주·포워더.
핵심 질문: "부산발 내 화물 스케줄·운임에 지금 당장 영향이 있는가?"
${portContext}

아래 뉴스 목록에서 한국 화주·포워더에게 실질적으로 중요한 3개를 선정하세요.

평가 기준 (한국 관련성 우선):
+5: 부산·인천·광양 출발/도착 노선 직접 영향 (블랭크 세일링, GRI, 서비스 중단·변경)
+5: 한국 주요 수출입 항로 운임 수치 (KCCI·WCI·FBX, 한국 노선 $/FEU 구체 수치 포함)
+4: HMM 서비스 공지, 또는 한국 기항 포함 선사 공지 (Maersk·MSC·CMA CGM·ONE 등)
+4: 한국 주요 수출 항로 운항 변경 (미주 서안·북유럽·동남아·중국 노선)
+3: Blank Sailing / Void Sailing (⚡HIGH 태그, 한국 기항 서비스 포함 가능성)
+2: 부산·상하이·싱가포르·롱비치 등 한국 관련 주요 항만 혼잡·대기 정보
+1: 한국 노선과 무관하지만 글로벌 운임 크게 영향 (대규모 항로 봉쇄·운임 지수 급등)
-2: 한국 항로와 무관한 지역 이슈 (대서양 항로, 유럽 내수 항만, 아프리카 항로)
-3: 군사 성명·발표·부인 (직접 항로 제한·운임 영향 없는 것)
-4: 한국 수출입과 무관한 해역 인시던트 (오만·홍해 원유 관련, 한국 컨테이너 노선 영향 없는 것)
-5: 해운·물류와 직접 무관한 뉴스

⛔ 절대 제외 — 점수와 무관하게 선정 금지:
- 군사 발표·부인 (미 해군 성명, 군사 작전 논평 등)
- 한국 노선 직접 영향 없는 단순 국제 선박 사고
- 물류 수치(운임·일정·TEU) 없는 외교·정치 기사
- 관련 기사가 3개 미만이면 links를 빈 배열로 줄여도 됨
- 적격 기사가 0개면 main.title_ko = "오늘 한국 노선 관련 뉴스 없음"으로 출력

Red Sea/Hormuz 선정 기준: 부산발 아시아-유럽·중동 노선에 실제 우회·운임 영향이 확인된 경우만.
단순 지역 인시던트나 군사 동향은 제외.

출력 규칙 (엄격히 준수):
- main: 한국 화주·포워더 실무에 가장 직결되는 기사. 없으면 오늘 없음으로 출력.
- main.what: 200자 이하. 무슨 일이 일어났나.
- main.why_now: 200자 이하. 한국 화주 기준으로 왜 지금 중요한가.
- main.checkpoint: 200자 이하. 한국 화주·포워더가 지금 해야 할 구체적인 행동 1가지.
- links: 한국 관련 2번째, 3번째 뉴스만. 한국 무관 기사는 links에도 절대 포함 금지.
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
