'use strict';

const fs = require('fs');
const path = require('path');
const ws = require('ws');
globalThis.WebSocket = ws;

const { createClient } = require('@supabase/supabase-js');
const { categoryFor, resolveArticle } = require('./lib/news-pipeline');

require('dotenv').config({ path: path.resolve(__dirname, '../../.env.local') });
const DRAFTS_DIR = path.resolve(__dirname, '../../content/drafts');
const SECTIONS = ['rail', 'ocean', 'air', 'trade', 'logistics'];
const KEYWORDS = {
  rail: 'freight train railway china',
  ocean: 'container port cargo ship',
  air: 'air cargo aircraft freighter',
  trade: 'customs tariff global trade',
  logistics: 'logistics warehouse supply chain',
};
const stats = Object.fromEntries(SECTIONS.map((section) => [section, 0]));

async function publishCard(supabase, item, section, isHero) {
  if (!item?.url || !item?.title_ko || !item?.source) return;
  const asset = await resolveArticle(item.url, {
    source: item.source,
    keyword: KEYWORDS[section],
    title: item.title_ko,
  });
  const { error } = await supabase.from('maritime_news').upsert({
    title: item.title_ko,
    summary: item.what || item.summary_ko || item.title_ko,
    content: null,
    url: item.url,
    source: item.source,
    category: categoryFor(section),
    lang: 'ko',
    is_hero: isHero,
    agent_type: 'daily_card',
    tags: [section],
    slug: null,
    published_at: item.published_at || null,
    fetched_at: new Date().toISOString(),
    image_url: asset.imageUrl,
    image_source: asset.imageSource,
    image_credit: asset.imageCredit,
  }, { onConflict: 'url', ignoreDuplicates: false });
  if (error) throw new Error(error.message);
  stats[section]++;
}

async function main() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_URL 또는 SUPABASE_SERVICE_ROLE_KEY 없음');
  }
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
    realtime: { enabled: false },
  });

  for (const section of SECTIONS) {
    const file = path.join(DRAFTS_DIR, `curated-${section}.json`);
    if (!fs.existsSync(file)) {
      console.warn(`⚠️ [${section}] curated 파일 없음`);
      continue;
    }
    const curated = JSON.parse(fs.readFileSync(file, 'utf8'));
    await publishCard(supabase, curated.main, section, true);
    for (const link of curated.links || []) await publishCard(supabase, link, section, false);
  }

  console.log(`📊 daily_card 게시 건수: ${JSON.stringify(stats)}`);
  for (const section of SECTIONS) {
    if (stats[section] === 0) console.warn(`⚠️ [${section}] daily_card 0건`);
  }
}

main().catch((error) => {
  console.error(`❌ publish-daily-cards-to-site 실패: ${error.message}`);
  process.exit(1);
});
