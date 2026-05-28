// scripts/lib/supabase-insert.js
// maritime_news INSERT 헬퍼 (CJS, generate-article-*.js에서 require)
// 환경변수: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

'use strict';

const { createClient } = require('@supabase/supabase-js');
const fs   = require('fs');
const path = require('path');

// .env.local 파일에서 환경변수를 로드 (dotenv 불필요)
function loadEnvLocal() {
  const envPath = path.resolve(__dirname, '../../.env.local');
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, 'utf-8').split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].trim();
    }
  }
}
loadEnvLocal();

const SUPABASE_URL  = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

// frontmatter 이후 본문 추출
function extractContent(md) {
  const m = md.match(/^---[\s\S]*?---\s*([\s\S]*)$/);
  return m ? m[1].trim() : md.trim();
}

// canonicalUrl에서 slug 추출 (/article/{slug})
function extractSlug(url) {
  if (!url) return null;
  const m = url.match(/\/article\/([^/?#]+)/);
  return m ? m[1] : null;
}

// YAML frontmatter 값 추출
function extractFm(md, key) {
  const re = new RegExp(`^${key}:\\s*["']?(.+?)["']?\\s*$`, 'm');
  const m = md.match(re);
  return m ? m[1].trim() : null;
}

// YAML tags 배열 추출: tags: ["a", "b"]
function extractTags(md) {
  const m = md.match(/^tags:\s*\[(.+?)\]/m);
  if (!m) return [];
  return m[1].split(',').map(t => t.trim().replace(/['"]/g, ''));
}

// 키워드 기반 카테고리 분류
const CLASSIFY_RULES = [
  { pattern: /선박|해운|컨테이너|운임|선사|TEU|항로|해상|선적|물동량/i, category: '해상' },
  { pattern: /항공|화물기|공항|air cargo|flight|AWB/i,                   category: '항공' },
  { pattern: /철도|TCR|TSR|열차|rail|train|유라시아|코리도/i,             category: '철도' },
  { pattern: /포워더|창고|3PL|공급망|SCM|logistics/i,                     category: '물류' },
  { pattern: /관세|수출|수입|FTA|무역|통관|HS코드|CBAM|ETS|제재/i,         category: '무역' },
];

function classifyCategory(title, summary) {
  const text = `${title} ${summary ?? ''}`;
  for (const rule of CLASSIFY_RULES) {
    if (rule.pattern.test(text)) return rule.category;
  }
  return '물류';
}

/**
 * 생성된 기사를 maritime_news에 upsert.
 * @param {object} opts
 * @param {string} opts.markdownContent - 전체 마크다운 (frontmatter 포함)
 * @param {string} opts.canonicalUrl    - 기사 고유 URL (slug 기반)
 * @param {string} opts.agentType       - 'shipping' | 'corp' | 'brief'
 * @param {string} [opts.defaultCategory]
 */
async function insertArticle({ markdownContent, canonicalUrl, agentType, defaultCategory }) {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.warn('⚠️ [supabase-insert] SUPABASE 환경변수 없음 — maritime_news INSERT 스킵');
    return null;
  }

  const title    = extractFm(markdownContent, 'title');
  const subtitle = extractFm(markdownContent, 'subtitle');
  const category = extractFm(markdownContent, 'category') || defaultCategory
    || classifyCategory(title ?? '', subtitle ?? '');
  const imageUrl = extractFm(markdownContent, 'image_url');
  const tags     = extractTags(markdownContent);

  // maritime_news category 값은 해상|항공|철도|물류|무역으로 제한
  const VALID_CATEGORIES = ['해상', '항공', '철도', '물류', '무역'];
  const normalizedCategory = VALID_CATEGORIES.includes(category)
    ? category
    : classifyCategory(title ?? '', subtitle ?? '');

  if (!title) {
    console.warn('⚠️ [supabase-insert] frontmatter에서 title 추출 실패');
    return null;
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
    realtime: { enabled: false },
  });
  const row = {
    title,
    summary: subtitle ?? null,
    url: canonicalUrl,
    source: 'Logisight',
    lang: 'ko',
    category: normalizedCategory,
    agent_type: agentType,
    published_at: new Date().toISOString(),
    tags: tags.length ? tags : null,
    image_url: imageUrl || null,
    slug: extractSlug(canonicalUrl),
    content: extractContent(markdownContent),
    is_hero: false,
    fetched_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from('maritime_news')
    .upsert(row, { onConflict: 'url', ignoreDuplicates: false })
    .select('id')
    .maybeSingle();

  if (error) {
    console.error('❌ [supabase-insert] maritime_news upsert 실패:', error.message);
    return null;
  }

  const insertedId = data?.id ?? null;
  console.log(`✅ maritime_news 저장 완료 (id: ${insertedId})`);
  return insertedId;
}

module.exports = { insertArticle, classifyCategory };
