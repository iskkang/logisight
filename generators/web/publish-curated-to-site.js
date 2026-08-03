'use strict';

const fs = require('fs');
const path = require('path');
const ws = require('ws');
globalThis.WebSocket = ws;

const { createClient } = require('@supabase/supabase-js');
const { callDeepSeek } = require('../lib/deepseek');
const {
  buildMainContent,
  categoryFor,
  generateKoreanAnalysis,
  resolveArticle,
  sanitizeArticleUrl,
} = require('./lib/news-pipeline');

const DRAFTS_DIR = path.resolve(__dirname, '../../content/drafts');
const TODAY = new Date().toISOString().slice(0, 10);
const SECTIONS = ['rail', 'ocean', 'air', 'trade', 'logistics'];
const KEYWORDS = {
  rail: 'freight train railway china',
  ocean: 'container port cargo ship',
  air: 'air cargo aircraft freighter',
  trade: 'customs tariff global trade',
  logistics: 'logistics warehouse supply chain',
};

require('dotenv').config({ path: path.resolve(__dirname, '../../.env.local') });
const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  { auth: { persistSession: false }, realtime: { enabled: false } },
);

const stats = {
  published: Object.fromEntries(SECTIONS.map((section) => [section, 0])),
  images: { original: 0, unsplash: 0, missing: 0 },
};

function makeSlug(date, title) {
  return `${date}-${String(title || '')
    .toLowerCase()
    .replace(/[^a-z0-9가-힣\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 60)}`;
}

function recordImage(asset) {
  if (asset.imageSource === 'original') stats.images.original++;
  else if (asset.imageSource === 'unsplash') stats.images.unsplash++;
  else stats.images.missing++;
}

async function upsert(row, section, mode) {
  const { error } = await supabase
    .from('maritime_news')
    .upsert(row, { onConflict: 'url', ignoreDuplicates: false });
  if (error) throw new Error(error.message);
  stats.published[section]++;
  console.log(`✅ [${section}][${mode}] ${row.title.slice(0, 50)}`);
}

async function publishMain(curated) {
  const { main, section } = curated;
  if (!main?.url || !(main.importance_score > 0) || !main.title_ko || !main.source) return;

  const asset = await resolveArticle(main.url, {
    source: main.source,
    keyword: KEYWORDS[section],
    title: main.title_ko,
  });
  recordImage(asset);
  const generated = await generateKoreanAnalysis(
    callDeepSeek,
    asset.articleText,
    `${main.source} / ${main.title_ko}`,
  );
  const content = generated?.body || null;

  const date = curated.date || TODAY;
  const row = {
    title: generated?.title || main.title_ko,
    summary: main.what || null,
    content: content || buildMainContent(main) || null,
    url: main.url,
    source: main.source,
    category: categoryFor(section),
    lang: 'ko',
    is_hero: true,
    agent_type: 'brief',
    tags: [section],
    slug: makeSlug(date, main.title_ko),
    published_at: main.published_at || new Date().toISOString(), // 소스 날짜 없으면 게시 시각으로(사이트 정렬·표시용 NULL 방지)
    fetched_at: new Date().toISOString(),
    image_url: asset.imageUrl,
    image_source: asset.imageSource,
    image_credit: asset.imageCredit,
  };
  await upsert(row, section, '내부기사');
}

async function publishLink(link, section, date) {
  // 외부 링크 행은 사이트에서 원문으로 리다이렉트된다 — 무효 URL이 저장되면 깨진 Location이 나간다.
  const url = sanitizeArticleUrl(link.url);
  if (link.url && !url) {
    console.warn(`  ⚠️ [${section}] 원문 URL 무효 — 건너뜀: ${link.url}`);
    return;
  }
  if (!link.title_ko || !url || !link.source) return;
  const asset = await resolveArticle(url, {
    source: link.source,
    keyword: KEYWORDS[section],
    title: link.title_ko,
  });
  recordImage(asset);

  const generated = await generateKoreanAnalysis(
    callDeepSeek,
    asset.articleText,
    `${link.source} / ${link.title_ko}`,
  );
  const content = generated?.body || null;
  const isInternal = Boolean(content);
  const row = {
    title: (isInternal && generated?.title) || link.title_ko,
    summary: link.summary_ko || link.title_ko,
    content,
    url,
    source: link.source,
    category: categoryFor(section),
    lang: 'ko',
    is_hero: false,
    agent_type: isInternal ? 'brief' : 'external',
    tags: [section],
    slug: isInternal ? makeSlug(date, link.title_ko) : null,
    published_at: link.published_at || new Date().toISOString(), // 소스 날짜 없으면 게시 시각으로(NULL 방지)
    fetched_at: new Date().toISOString(),
    image_url: asset.imageUrl,
    image_source: asset.imageSource,
    image_credit: asset.imageCredit,
  };
  await upsert(row, section, isInternal ? '내부기사' : '외부링크');
}

async function processSection(section) {
  const file = path.join(DRAFTS_DIR, `curated-${section}.json`);
  if (!fs.existsSync(file)) {
    console.warn(`⚠️ [${section}] curated 파일 없음`);
    return;
  }
  const curated = JSON.parse(fs.readFileSync(file, 'utf8'));
  const date = curated.date || TODAY;
  await publishMain(curated);
  for (const link of curated.links || []) {
    try {
      await publishLink(link, section, date);
    } catch (error) {
      console.error(`❌ [${section}] ${link.url}: ${error.message}`);
    }
  }
}

async function main() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_URL 또는 SUPABASE_SERVICE_ROLE_KEY 없음');
  }
  for (const section of SECTIONS) await processSection(section);
  console.log(`📊 게시 건수: ${JSON.stringify(stats.published)}`);
  console.log(`🖼️ 이미지: ${JSON.stringify(stats.images)}`);
  for (const section of SECTIONS) {
    if (stats.published[section] === 0) {
      console.warn(`⚠️ [${section}] 게시 0건: curated 파일 누락 또는 적격 기사 없음`);
    }
  }
}

main().catch((error) => {
  console.error(`❌ publish-curated-to-site 실패: ${error.message}`);
  process.exit(1);
});
