// scripts/generate-article-brief.js
// 글로벌 물류 브리핑 기사 생성 (패턴 D: 지역별 브리핑)
// 입력: content/drafts/latest-news.json (전체 섹션)
// 출력: content/articles/{YYYY-MM-DD}-brief.md
//
// 사용법:
//   node scripts/generate-article-brief.js
//   node scripts/generate-article-brief.js --window=7  (주간 브리핑)
//   node scripts/generate-article-brief.js --type=trend  (트렌드 분석 기사)

const fs      = require('fs');
const path    = require('path');
const https   = require('https');
const Anthropic = require('@anthropic-ai/sdk').default;
const { insertArticle } = require('./lib/supabase-insert');

const TODAY      = new Date().toISOString().slice(0, 10);
const NEWS_PATH  = path.resolve(__dirname, '../content/drafts/latest-news.json');
const ARTICLES_DIR = path.resolve(__dirname, '../content/articles');

const windowArg  = process.argv.find(a => a.startsWith('--window='));
const windowDays = windowArg ? parseInt(windowArg.split('=')[1]) : 3;
const cutoff     = new Date(Date.now() - windowDays * 86_400_000).toISOString();

const typeArg    = process.argv.find(a => a.startsWith('--type='));
const ARTICLE_TYPE = typeArg ? typeArg.split('=')[1] : 'brief'; // brief | trend

// 브리핑 유형별 Unsplash 키워드
const KEYWORD_MAP = {
  brief: 'global logistics shipping port',
  trend: 'supply chain logistics global trade',
};

// ── Unsplash 이미지 fetch ──────────────────────────────────────────────────
function fetchUnsplashImage(keyword) {
  const key = process.env.UNSPLASH_ACCESS_KEY;
  if (!key) {
    console.warn('⚠️ UNSPLASH_ACCESS_KEY 없음 — 이미지 스킵');
    return Promise.resolve(null);
  }
  const url = `https://api.unsplash.com/photos/random?query=${encodeURIComponent(keyword)}&orientation=landscape&client_id=${key}`;
  return new Promise((resolve) => {
    https.get(url, { headers: { 'Accept-Version': 'v1' } }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const base = json.urls?.regular;
          if (!base) return resolve(null);
          resolve(base + '&w=800&h=450&fit=crop');
        } catch { resolve(null); }
      });
    }).on('error', () => resolve(null));
  });
}

// ── 뉴스 로드 (전체 섹션 합산) ─────────────────────────────────────────────
function loadAllItems() {
  if (!fs.existsSync(NEWS_PATH)) {
    console.warn('⚠️ latest-news.json 없음 — 스킵');
    process.exit(0);
  }
  const data  = JSON.parse(fs.readFileSync(NEWS_PATH, 'utf-8'));

  // 브리핑 관련 섹션 합산 (carrier_advisory 는 corp 전용이라 제외)
  const sections = ['shipping', 'rail', 'air', 'policy', 'trade', 'risk'];
  const allItems = sections.flatMap(s => data[s] || []).filter(i => {
    if (!i.published_at) return true;
    return i.published_at >= cutoff;
  });

  const seen = new Set();
  return allItems.filter(i => {
    if (!i.url || seen.has(i.url)) return false;
    seen.add(i.url);
    return true;
  });
}

// ── Claude 브리핑 기사 생성 ───────────────────────────────────────────────
async function generateBriefArticle(items, imageUrl, keyword) {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  // 최대 20건만 제공 (토큰 절약)
  const itemList = items.slice(0, 20).map((i, idx) =>
    `${idx + 1}. [${i.source || i.section}] ${i.title_en || i.title} — ${i.url}`
  ).join('\n');

  const dateLabel = windowDays >= 7
    ? `${TODAY} 주간`
    : `${TODAY}`;

  const structureGuide = ARTICLE_TYPE === 'trend'
    ? `패턴 E (트렌드 분석):
  1단 현상 리드 (핵심 트렌드 + 수치 1~2문장)
  2단 데이터 상세 (지역별·노선별·카테고리별 수치, 전주/전월 비교)
  3단 원인 분석 (수요·공급·지정학 요인)
  4단 영향과 전망 (시장 전망 + 한국 화주·포워더 시사점)`
    : `패턴 D (지역별 브리핑):
  도입 1~2문장 (전체 분위기 요약)
  지역별 항목 (동아시아→동남아→중동→유럽→미주 순)
  각 항목: [지역]: [기업명], [핵심 행위] + 2~4문장 요약 + (출처)
  마무리: 이번 주 핵심 키워드 #태그1 #태그2 #태그3`;

  // category는 항상 '물류' (VALID_CATEGORIES 통과). 기사 유형은 article_type 필드로 구분.
  const categoryLabel = '물류';

  const prompt = `당신은 글로벌 물류 시장 브리핑·트렌드 분석 전문 기자입니다. 코리아쉬핑가제트(KSG) 스타일로 기사를 작성합니다.
독자: 한국 화주·포워더 (한국 관련 → 중국 → 미주 → 러시아 → CIS 순으로 중요도 적용)

## 입력 뉴스 (${items.length}건, 최대 20건 표시)
${itemList}

## 작성 구조
${structureGuide}

## 제목 형식
${ARTICLE_TYPE === 'trend'
  ? '[현상 명사구] ... [원인 또는 배경]\n  부제: [핵심 수치 또는 세부 내용]'
  : `${dateLabel} 글로벌 물류 동향 브리프\n  부제: [전체 분위기 1줄]`}

## 규칙
- Logisight 독자 무관 기사 제외 (봉사활동·CSR·임직원 포상·스포츠·군사 발표 제외)
- 지역 순서: 동아시아→동남아→중동→유럽→미주
- 각 항목 2~4문장 균일 분량
- 추측은 "~전망이다" "~분석이다"
- ${ARTICLE_TYPE === 'brief' ? '패턴 D면 마지막에 핵심 키워드 3개 필수' : '수치 없이 트렌드만 서술 금지'}

이미지:
image_url: ${imageUrl || ''}
image_keyword: ${keyword}

아래 형식으로만 출력하세요 (설명 없이):

\`\`\`markdown
---
title: "제목"
subtitle: "부제"
category: "${categoryLabel}"
tags: ["태그1", "태그2", "태그3"]
author: "Logisight 편집팀"
date: ${TODAY}
article_type: "${ARTICLE_TYPE}"
sources: ["출처1", "출처2"]
image_url: "${imageUrl || ''}"
image_keyword: "${keyword}"
image_credit: "Photo: Unsplash"
status: draft
---

# 제목
## 부제

![제목](${imageUrl || ''})
*Photo: Unsplash*

{기사 본문}

---
*출처: 출처1, 출처2*
\`\`\``;

  const msg = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4000,
    messages: [{ role: 'user', content: prompt }],
  });

  const raw     = msg.content[0].text.trim();
  const mdMatch = raw.match(/```markdown\n([\s\S]*?)```/) || raw.match(/```\n([\s\S]*?)```/);
  return mdMatch ? mdMatch[1].trim() : raw;
}

// ── main ───────────────────────────────────────────────────────────────────
async function main() {
  const items = loadAllItems();
  console.log(`📰 전체 뉴스 ${items.length}건 로드 (window: ${windowDays}d, type: ${ARTICLE_TYPE})`);

  if (items.length === 0) {
    console.warn('⚠️ 뉴스 0건 — 기사 생성 스킵');
    process.exit(0);
  }

  const keyword  = KEYWORD_MAP[ARTICLE_TYPE] || KEYWORD_MAP.brief;
  console.log(`🖼️  Unsplash 이미지 수집 (keyword: ${keyword})`);
  const imageUrl = await fetchUnsplashImage(keyword);
  if (imageUrl) console.log(`   → ${imageUrl.slice(0, 60)}...`);
  else          console.log('   → 이미지 없음 (null)');

  console.log(`✍️  Claude 브리핑 기사 생성 중...`);
  const article = await generateBriefArticle(items, imageUrl, keyword);

  if (!fs.existsSync(ARTICLES_DIR)) fs.mkdirSync(ARTICLES_DIR, { recursive: true });

  const suffix   = windowDays >= 7 ? 'weekly-brief' : ARTICLE_TYPE;
  const filename = `${TODAY}-${suffix}.md`;
  const outPath  = path.join(ARTICLES_DIR, filename);

  fs.writeFileSync(outPath, article, 'utf-8');
  console.log(`✅ 기사 저장: content/articles/${filename}`);

  // maritime_news upsert
  const canonicalUrl = `https://logisight.mtlship.com/article/${TODAY}-${suffix}`;
  await insertArticle({
    markdownContent: article,
    canonicalUrl,
    agentType: 'brief',
    defaultCategory: '물류',
  });
}

main().catch(e => { console.error('❌ generate-article-brief 실패:', e.message); process.exit(1); });
