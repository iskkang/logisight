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
const https     = require('https');
const { callDeepSeek } = require('../lib/deepseek');
const { insertArticle } = require('../../lib/supabase-insert');

const TODAY        = new Date().toISOString().slice(0, 10);
const DRAFTS_DIR   = path.resolve(__dirname, '../../content/drafts');
const ARTICLES_DIR = path.resolve(__dirname, '../../content/articles');

// ── 스타일 가이드 로드 (시스템 프롬프트 주입용) ──────────────────────────
const STYLE_GUIDE = fs.readFileSync(
  path.resolve(__dirname, 'WEB_ARTICLE_STYLE.md'),
  'utf-8'
);

const sectionArg = process.argv.find(a => a.startsWith('--section='));
const SECTION    = sectionArg ? sectionArg.split('=')[1] : 'rail'; // rail | ocean

if (!['rail', 'ocean'].includes(SECTION)) {
  console.error('❌ --section=rail 또는 --section=ocean 지정 필요');
  process.exit(1);
}

const CURATED_PATH = path.join(DRAFTS_DIR, `curated-${SECTION}.json`);

// 섹션별 Unsplash 기본 키워드
const DEFAULT_KEYWORD = {
  rail:  'freight train railway china',
  ocean: 'container port cargo ship',
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

// ── Claude 기사 생성 ──────────────────────────────────────────────────────
async function generateArticle(curated, imageUrl, imageKeyword) {

  const linksText = (curated.links || [])
    .map(l => `- [${l.source}] ${l.title_ko || l.title} — ${l.url}`)
    .join('\n');

  const sectionLabel = SECTION === 'rail' ? '철도' : '해운';
  const category     = SECTION === 'rail' ? '철도' : '해상';

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
image_url: ${imageUrl || 'null'}
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
image_url: "${imageUrl || ''}"
image_keyword: "${imageKeyword}"
image_credit: "Photo: Unsplash"
agent_type: "shipping"
status: draft
---

# 제목
## 부제

![제목](${imageUrl || ''})
*Photo: Unsplash*

{기사 본문 — 4단 구성, 600~1000자, H2 소제목 2~3개}

---
*출처: 출처1, 출처2*
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
  console.log(`🖼️  Unsplash 이미지 수집 (keyword: ${keyword})`);
  const imageUrl = await fetchUnsplashImage(keyword);
  if (imageUrl) console.log(`   → ${imageUrl.slice(0, 60)}...`);
  else          console.log('   → 이미지 없음 (null)');

  console.log(`✍️  Claude 기사 생성 중... (스타일 가이드 주입됨)`);
  const article = await generateArticle(curated, imageUrl, keyword);

  if (!fs.existsSync(ARTICLES_DIR)) fs.mkdirSync(ARTICLES_DIR, { recursive: true });

  const slug     = makeSlug(curated.main.title_ko || curated.main.title);
  const filename = `${TODAY}-${SECTION}-${slug}.md`;
  const outPath  = path.join(ARTICLES_DIR, filename);

  fs.writeFileSync(outPath, article, 'utf-8');
  console.log(`✅ 기사 저장: content/articles/${filename}`);

  // maritime_news upsert
  const canonicalUrl    = `https://logisight.mtlship.com/article/${TODAY}-${SECTION}-${slug}`;
  const defaultCategory = SECTION === 'rail' ? '철도' : '해상';
  await insertArticle({
    markdownContent: article,
    canonicalUrl,
    agentType: 'shipping',
    defaultCategory,
  });
}

main().catch(e => { console.error(`❌ generate-article-${SECTION} 실패:`, e.message); process.exit(1); });
