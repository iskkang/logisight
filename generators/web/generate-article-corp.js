// generators/web/generate-article-corp.js
// 기업 발표·공시·노선 개설 KSG 기사 생성 (agent_type = 'corp')
// 입력: content/drafts/latest-news.json (.carrier_advisory 섹션)
// 출력: content/articles/{YYYY-MM-DD}-corp-{slug}.md + maritime_news upsert
//
// 사용법:
//   node generators/web/generate-article-corp.js
//   node generators/web/generate-article-corp.js --window=7

const fs        = require('fs');
const path      = require('path');
const https     = require('https');
const Anthropic = require('@anthropic-ai/sdk').default;
const { insertArticle } = require('../../lib/supabase-insert');

const TODAY        = new Date().toISOString().slice(0, 10);
const NEWS_PATH    = path.resolve(__dirname, '../../content/drafts/latest-news.json');
const ARTICLES_DIR = path.resolve(__dirname, '../../content/articles');

// ── 스타일 가이드 로드 (시스템 프롬프트 주입용) ──────────────────────────
const STYLE_GUIDE = fs.readFileSync(
  path.resolve(__dirname, 'WEB_ARTICLE_STYLE.md'),
  'utf-8'
);

const windowArg  = process.argv.find(a => a.startsWith('--window='));
const windowDays = windowArg ? parseInt(windowArg.split('=')[1]) : 3;
const cutoff     = new Date(Date.now() - windowDays * 86_400_000).toISOString();

// 기업 기사 유형별 Unsplash 키워드
const KEYWORD_MAP = {
  '항공기 발주':  'cargo aircraft freighter aviation',
  '선박 발주':   'container ship cargo vessel',
  '인증 획득':   'logistics certification pharma cold chain',
  '재무 실적':   'freight forwarder logistics office',
  '인수합병':    'logistics merger business deal',
  '콜드체인':    'cold chain logistics warehouse',
  '노선 개설':   'airport cargo terminal',
  '물류센터':    'logistics warehouse distribution center',
  '기본':        'shipping company logistics cargo',
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

// ── 뉴스 로드 ────────────────────────────────────────────────────────────
function loadCorpItems() {
  if (!fs.existsSync(NEWS_PATH)) {
    console.warn('⚠️ latest-news.json 없음 — 스킵');
    process.exit(0);
  }
  const data  = JSON.parse(fs.readFileSync(NEWS_PATH, 'utf-8'));
  const items = (data.carrier_advisory || []).filter(i => {
    if (!i.published_at) return true;
    return i.published_at >= cutoff;
  });
  const seen = new Set();
  return items.filter(i => {
    if (!i.url || seen.has(i.url)) return false;
    seen.add(i.url);
    return true;
  });
}

// ── Step 1: 기사 선정 + 유형 판별 (Haiku — 경량 분류) ────────────────────
async function selectArticle(items, client) {
  const itemList = items.slice(0, 10).map((i, idx) =>
    `${idx + 1}. [${i.source}] ${i.title_en || i.title} — ${i.url}`
  ).join('\n');

  const selectPrompt = `다음 선사 공지·기업 뉴스 목록에서 Logisight 독자(화주·포워더)에게 가장 중요한 기사 1건을 선정하세요.

기사 목록:
${itemList}

선정 기준 (높은 순):
- 선사 서비스 변경·신설·종료 (Blank Sailing, 기항지 변경 포함)
- 항공기·선박 발주 완료
- 주요 선사·포워더 재무 실적
- 인수합병 완료
- 노선 개설·폐지
- 콜드체인·물류센터 구축
- 인증 획득 (CEIV, ISO)

제외: 봉사활동, 임직원 포상, 기업 창립기념, 군사/정치 뉴스

JSON으로만 응답:
{
  "selected_index": 1,
  "article_type": "항공기 발주 | 선박 발주 | 인증 획득 | 재무 실적 | 인수합병 | 콜드체인 | 노선 개설 | 물류센터 | 기본",
  "pattern": "B | C",
  "unsplash_keyword": "적절한 Unsplash 키워드 (영어)"
}`;

  const msg = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 256,
    messages: [{ role: 'user', content: selectPrompt }],
  });

  try {
    const raw = msg.content[0].text.trim();
    return JSON.parse(raw.match(/\{[\s\S]*\}/)[0]);
  } catch {
    return { selected_index: 1, article_type: '기본', pattern: 'B', unsplash_keyword: KEYWORD_MAP['기본'] };
  }
}

// ── Step 2: 기사 작성 (Sonnet — 스타일 가이드 주입) ──────────────────────
async function writeArticle(selectedItem, selection, imageUrl, client) {
  const keyword      = selection.unsplash_keyword || KEYWORD_MAP[selection.article_type] || KEYWORD_MAP['기본'];
  const patternGuide = selection.pattern === 'C'
    ? `패턴 C (노선 개설): ① 노선 개요 리드 → ② 노선 세부 → ③ 전략적 의미 → ④ 향후 계획`
    : `패턴 B (기업 발표): ① 핵심 발표 리드 → ② 세부 내용 → ③ 배경·전략 → ④ 시장 시사점`;

  const wordCount = selection.article_type === '인수합병' ? '800~1000자' : '600~800자';

  // ── 시스템 프롬프트: 스타일 가이드 전체 주입 ─────────────────────────
  const systemPrompt = `당신은 15년 경력의 해운·물류 기업 동향 전문 기자입니다.
아래 스타일 가이드를 반드시 따라 기사를 작성하십시오.

${STYLE_GUIDE}`;

  // ── 유저 프롬프트: 입력 데이터 + 구조 지시 ──────────────────────────
  const userPrompt = `## 입력 기사
제목: ${selectedItem.title_en || selectedItem.title}
URL: ${selectedItem.url}
출처: ${selectedItem.source}
${selectedItem.summary ? `요약: ${selectedItem.summary}` : ''}

## 구조
${patternGuide}
분량: ${wordCount}

## 이미지
image_url: ${imageUrl || ''}
image_keyword: ${keyword}

## 제목 형식
[기업명], [핵심 행위] (명사형 종결, 25~35자)
부제: [배경 또는 세부 내용] (70~80자)

## 출력 형식 (YAML front-matter + 마크다운 본문만, 다른 설명 없이)

\`\`\`markdown
---
title: "제목"
subtitle: "부제"
category: "해운 | 항공 | 철도 | 물류 | 기업"
tags: ["태그1", "태그2", "태그3"]
author: "Logisight 편집팀"
date: ${TODAY}
sources: ["${selectedItem.source}"]
image_url: "${imageUrl || ''}"
image_keyword: "${keyword}"
image_credit: "Photo: Unsplash"
agent_type: "corp"
status: draft
---

# 제목
## 부제

![제목](${imageUrl || ''})
*Photo: Unsplash*

{기사 본문}

---
*출처: ${selectedItem.source}*
\`\`\``;

  const msg = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 3000,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  });

  const raw     = msg.content[0].text.trim();
  const mdMatch = raw.match(/```markdown\n([\s\S]*?)```/) || raw.match(/```\n([\s\S]*?)```/);
  return { article: mdMatch ? mdMatch[1].trim() : raw, keyword };
}

// ── 슬러그 생성 ────────────────────────────────────────────────────────────
function makeSlug(title) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9가-힣\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 50);
}

// ── main ───────────────────────────────────────────────────────────────────
async function main() {
  const items = loadCorpItems();
  console.log(`📰 carrier_advisory 뉴스 ${items.length}건 로드 (window: ${windowDays}d)`);

  if (items.length === 0) {
    console.warn('⚠️ carrier_advisory 뉴스 0건 — 스킵');
    process.exit(0);
  }

  const client    = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const selection = await selectArticle(items, client);

  const selectedItem = items[selection.selected_index - 1] || items[0];
  const keyword      = selection.unsplash_keyword || KEYWORD_MAP[selection.article_type] || KEYWORD_MAP['기본'];

  console.log(`📌 선정: [${selectedItem.source}] ${(selectedItem.title_en || selectedItem.title).slice(0, 60)}`);
  console.log(`📂 유형: ${selection.article_type} (패턴 ${selection.pattern})`);
  console.log(`🖼️  Unsplash 키워드: ${keyword}`);

  const imageUrl = await fetchUnsplashImage(keyword);
  if (imageUrl) console.log(`   → ${imageUrl.slice(0, 60)}...`);
  else          console.log('   → 이미지 없음 (null)');

  console.log(`✍️  Claude 기사 생성 중... (스타일 가이드 주입됨)`);
  const { article } = await writeArticle(selectedItem, selection, imageUrl, client);

  if (!fs.existsSync(ARTICLES_DIR)) fs.mkdirSync(ARTICLES_DIR, { recursive: true });

  const slug     = makeSlug(selectedItem.title_en || selectedItem.title);
  const filename = `${TODAY}-corp-${slug}.md`;
  const outPath  = path.join(ARTICLES_DIR, filename);

  fs.writeFileSync(outPath, article, 'utf-8');
  console.log(`✅ 기사 저장: content/articles/${filename}`);

  // maritime_news upsert
  const slug2        = makeSlug(selectedItem.title_en || selectedItem.title);
  const canonicalUrl = `https://logisight.mtlship.com/article/${TODAY}-corp-${slug2}`;
  await insertArticle({
    markdownContent: article,
    canonicalUrl,
    agentType: 'corp',
    defaultCategory: '물류',
  });
}

main().catch(e => { console.error('❌ generate-article-corp 실패:', e.message); process.exit(1); });
