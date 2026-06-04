'use strict';

const path = require('path');
const ws = require('ws');
globalThis.WebSocket = ws;
require('dotenv').config({ path: path.resolve(__dirname, '../.env.local') });

const { createClient } = require('@supabase/supabase-js');
const { resolveArticle, sanitizeImageUrl } = require('../generators/web/lib/news-pipeline');

const VALID = new Set(['해상', '항공', '철도', '무역', '물류']);
const SOURCE_RULES = [
  [/air\s*cargo|worldacd|iata|aircargoweek/i, '항공', 'air'],
  [/rail|seanews|portnews|landbridge|transport corridors|rzd|vgudok/i, '철도', 'rail'],
  [/supply chain dive|ustr|cbp|trade|customs|imo|kita|nlic|kotra|ttnews|eu /i, '무역', 'trade'],
  [/loadstar|splash|maersk|shipping|ocean|container news/i, '해상', 'ocean'],
  [/freightwaves|dhl|fedex|ups|logistics/i, '물류', 'logistics'],
];
const URL_RULES = [
  [/aircargo|worldacd|iata\.org|aircargoweek/i, '항공', 'air'],
  [/railfreight|seanews|portnews|landbridge|transportcorridors/i, '철도', 'rail'],
  [/ustr\.gov|cbp\.gov|taxation-customs|presscorner|kita\.net|nlic\.go\.kr|kotra/i, '무역', 'trade'],
  [/splash247|theloadstar|shipping|maritime/i, '해상', 'ocean'],
];
const COMBINED_RULES = [
  [/(?:^|[\/_-])(trade|policy)(?:[\/_-]|$)|\bustr\b|\bcbp\b|\bcustoms\b|\btariff\b|section\s*301/i, '무역', 'trade'],
  [/(?:^|[\/_-])(air)(?:[\/_-]|$)|air\s*cargo|worldacd|iata/i, '항공', 'air'],
  [/(?:^|[\/_-])(rail)(?:[\/_-]|$)|railfreight|landbridge/i, '철도', 'rail'],
  [/(?:^|[\/_-])(shipping|ocean)(?:[\/_-]|$)|maritime/i, '해상', 'ocean'],
];

function infer(row) {
  const tags = (row.tags || []).map(String);
  const tag = tags.find((value) => ['shipping', 'ocean', 'air', 'rail', 'trade', 'policy', 'logistics'].includes(value));
  const byTag = {
    shipping: ['해상', 'shipping'],
    ocean: ['해상', 'ocean'],
    air: ['항공', 'air'],
    rail: ['철도', 'rail'],
    trade: ['무역', 'trade'],
    policy: ['무역', 'trade'],
    logistics: ['물류', 'logistics'],
  }[tag];
  if (byTag) return byTag;
  const combined = [row.url, row.title, ...tags].filter(Boolean).join(' ');
  for (const [pattern, category, section] of COMBINED_RULES) {
    if (pattern.test(combined)) return [category, section];
  }
  for (const [pattern, category, section] of SOURCE_RULES) {
    if (pattern.test(row.source || '')) return [category, section];
  }
  for (const [pattern, category, section] of URL_RULES) {
    if (pattern.test(row.url || '')) return [category, section];
  }
  return ['물류', 'logistics'];
}

async function main() {
  const internalImages = process.argv.includes('--internal-images');
  const withImages = internalImages || process.argv.includes('--images');
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
    realtime: { enabled: false },
  });
  const { data: rows, error } = await supabase
    .from('maritime_news')
    .select('id,title,url,source,category,tags,content,slug,agent_type,image_url,image_source,image_credit');
  if (error) throw error;

  const stats = { scanned: rows.length, updated: 0, categories: {}, images: { original: 0, unsplash: 0 } };
  for (const row of rows) {
    const [inferredCategory, section] = infer(row);
    const patch = {};
    const validImageUrl = sanitizeImageUrl(row.image_url);
    if (!VALID.has(row.category) || (row.category === '물류' && inferredCategory === '무역')) {
      patch.category = inferredCategory;
    }
    if ((!row.tags || row.tags.length === 0) && section) patch.tags = [section];
    if (!row.content?.trim() && row.agent_type == null) patch.agent_type = 'external';
    if (!row.content?.trim() && row.slug) patch.slug = null;
    if (validImageUrl && !row.image_source) {
      patch.image_source = validImageUrl.includes('unsplash') ? 'unsplash' : 'original';
      patch.image_credit = validImageUrl.includes('unsplash') ? 'Photo: Unsplash' : row.source;
    }

    if (withImages && !validImageUrl && (!internalImages || row.slug)) {
      const asset = await resolveArticle(row.url, {
        source: row.source,
        keyword: `${section} ${row.source}`,
      });
      if (asset.imageUrl) {
        patch.image_url = asset.imageUrl;
        patch.image_source = asset.imageSource;
        patch.image_credit = asset.imageCredit;
        stats.images[asset.imageSource]++;
      } else if (row.image_url) {
        patch.image_url = null;
        patch.image_source = null;
        patch.image_credit = null;
      }
    } else if (row.image_url && !validImageUrl) {
      patch.image_url = null;
      patch.image_source = null;
      patch.image_credit = null;
    }

    if (Object.keys(patch).length === 0) continue;
    const { error: updateError } = await supabase.from('maritime_news').update(patch).eq('id', row.id);
    if (updateError) throw updateError;
    stats.updated++;
    const category = patch.category || row.category;
    stats.categories[category] = (stats.categories[category] || 0) + 1;
  }
  console.log(JSON.stringify(stats, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
