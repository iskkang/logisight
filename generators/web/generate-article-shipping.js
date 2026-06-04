// generators/web/generate-article-shipping.js
// 운임·시황 KSG 기사 생성 (agent_type = 'shipping')
// 입력: content/drafts/curated-rail.json 또는 curated-ocean.json
// 출력: content/articles/{YYYY-MM-DD}-{section}-article.md + maritime_news upsert
//
// 사용법:
//   node generators/web/generate-article-shipping.js --section=rail
//   node generators/web/generate-article-shipping.js --section=ocean

const fs        = require('fs');
const path      = require('path');
const { callDeepSeek } = require('../lib/deepseek');
const { insertArticle } = require('../../lib/supabase-insert');
const { categoryFor, resolveArticle } = require('./lib/news-pipeline');

const TODAY        = new Date().toISOString().slice(0, 10);
const DRAFTS_DIR   = path.resolve(__dirname, '../../content/drafts');
const ARTICLES_DIR = path.resolve(__dirname, '../../content/articles');

// ── 스타일 가이드 로드 (시스템 프롬프트 주입용) ──────────────────────────
const STYLE_GUIDE = fs.readFileSync(
  path.resolve(__dirname, 'WEB_ARTICLE_STYLE.md'),
  'utf-8'
);

const sectionArg = process.argv.find(a => a.startsWith('--section='));
const SECTION    = sectionArg ? sectionArg.split('=')[1] : 'rail'; // rail | ocean | air | trade | logistics

if (!['rail', 'ocean', 'air', 'trade', 'logistics'].includes(SECTION)) {
  console.error('❌ --section=rail|ocean|air|trade|logistics 지정 필요');
  process.exit(1);
}

const CURATED_PATH = path.join(DRAFTS_DIR, `curated-${SECTION}.json`);

// 섹션별 Unsplash 기본 키워드
const DEFAULT_KEYWORD = {
  rail:      'freight train railway china',
  ocean:     'container port cargo ship',
  air:       'air cargo aircraft freighter',
  trade:     'supply chain logistics trade',
  logistics: 'logistics warehouse dhl fedex',
};

// ── Claude 기사 생성 ──────────────────────────────────────────────────────
async function generateArticle(curated, asset, imageKeyword) {

  const linksText = (curated.links || [])
    .map(l => `- [${l.source}] ${l.title_ko || l.title} — ${l.url}`)
    .join('\n');

  const LABELS = { rail: '철도', ocean: '해운', air: '항공화물', trade: '무역·정책', logistics: '글로벌 물류' };
  const sectionLabel = LABELS[SECTION] ?? SECTION;
  const category     = categoryFor(SECTION);

  // ── 시스템 프롬프트: 스타일 가이드 전체 주입 ──────────────────────────
  const systemPrompt = `당신은 15년 경력의 해운·물류 전문 기자입니다.
아래 스타일 가이드를 반드시 따라 기사를 작성하십시오.

${STYLE_GUIDE}`;

  // ── 유저 프롬프트: 입력 데이터 + 출력 형식만 ─────────────────────────
  const userPrompt = `## 입력 데이터 (${sectionLabel} 섹션)

메인 기사:
  제목(영): ${curated.main.title}
  제목(한): ${curated.main.title_ko}
  출처: ${curated.main.source}
  URL: ${curated.main.url}
  what: ${curated.main.what}
  why_now: ${curated.main.why_now}
  checkpoint: ${curated.main.checkpoint}

관련 기사:
${linksText || '(없음)'}

## 이미지
image_url: ${asset.imageUrl || 'null'}
image_keyword: ${imageKeyword}

## 출력 형식 (YAML front-matter + 마크다운 본문만, 다른 설명 없이)

\`\`\`markdown
---
title: "제목 (명사형 종결, 25~35자, 키워드 앞 15자 이내)"
subtitle: "부제 (title 보완, 70~80자, SEO 메타용)"
category: "${category}"
tags: ["태그1", "태그2", "태그3"]
author: "Logisight 편집팀"
date: ${TODAY}
sources: ["출처1", "출처2"]
image_url: "${asset.imageUrl || ''}"
image_keyword: "${imageKeyword}"
image_source: "${asset.imageSource || ''}"
image_credit: "${asset.imageCredit || ''}"
agent_type: "shipping"
status: draft
---

{기사 본문 — 현상, 원인 또는 배경, 한국 화주·포워더 영향의 3개 구역. H1·부제·이미지·이미지 credit·중복 출처 문장은 넣지 말 것. 원문 사실만 사용하고 원문 전체 번역·장문 복제 금지.}
\`\`\``;

  const msg = await callDeepSeek({ max_tokens: 3000, system: systemPrompt, messages: [{ role: 'user', content: userPrompt }] });

  const raw     = msg.content[0].text.trim();
  const mdMatch = raw.match(/```markdown\n([\s\S]*?)```/) || raw.match(/```\n([\s\S]*?)```/);
  return mdMatch ? mdMatch[1].trim() : raw;
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
  if (!fs.existsSync(CURATED_PATH)) {
    console.error(`❌ ${CURATED_PATH} 없음 — 먼저 curate:${SECTION} 실행`);
    process.exit(1);
  }

  const curated = JSON.parse(fs.readFileSync(CURATED_PATH, 'utf-8'));

  if (!curated.main?.url || curated.main?.importance_score === 0) {
    console.warn(`⚠️ ${SECTION} 섹션 적격 기사 없음 — 기사 생성 스킵`);
    process.exit(0);
  }

  const keyword  = DEFAULT_KEYWORD[SECTION];
  console.log(`🖼️  원문 대표 이미지 확인 (fallback keyword: ${keyword})`);
  const asset = await resolveArticle(curated.main.url, {
    source: curated.main.source,
    keyword,
    title: curated.main.title_ko || curated.main.title,
  });
  console.log(`   → ${asset.imageSource || '이미지 없음'}`);

  console.log(`✍️  Claude 기사 생성 중... (스타일 가이드 주입됨)`);
  const article = await generateArticle(curated, asset, keyword);

  if (!fs.existsSync(ARTICLES_DIR)) fs.mkdirSync(ARTICLES_DIR, { recursive: true });

  const slug     = makeSlug(curated.main.title_ko || curated.main.title);
  const filename = `${TODAY}-${SECTION}-${slug}.md`;
  const outPath  = path.join(ARTICLES_DIR, filename);

  fs.writeFileSync(outPath, article, 'utf-8');
  console.log(`✅ 기사 저장: content/articles/${filename}`);

  // maritime_news upsert
  const canonicalUrl    = `https://logisight.mtlship.com/article/${TODAY}-${SECTION}-${slug}`;
  const defaultCategory = categoryFor(SECTION);
  await insertArticle({
    markdownContent: article,
    canonicalUrl,
    sourceUrl: curated.main.url,
    sourceName: curated.main.source,
    publishedAt: curated.main.published_at || null,
    agentType: 'shipping',
    defaultCategory,
  });
}

main().catch(e => { console.error(`❌ generate-article-${SECTION} 실패:`, e.message); process.exit(1); });
