'use strict';

const fs = require('fs');
const path = require('path');
const { XMLParser } = require('fast-xml-parser');

try {
  require('dotenv').config({ path: path.resolve(__dirname, '../.env.local'), quiet: true });
} catch (_) {}

const SOURCE = 'container-news';
const SECTION = 'rates-surcharges';
const FEED_URL = 'https://container-news.com/freight-news/feed/';
const LIST_URL = 'https://container-news.com/freight-news/';
const CACHE_SCHEMA = 1;
const CACHE_PATH = process.env.CN_RS_CACHE_PATH
  ? path.resolve(process.env.CN_RS_CACHE_PATH)
  : path.resolve(__dirname, '../outputs/cache/container-news-rates-surcharges.json');

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
  Accept: 'application/rss+xml, application/xml, text/xml, text/html, */*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

function warn(message, error) {
  const suffix = error && error.message ? ': ' + error.message : '';
  console.warn('[container-news-rates] ' + message + suffix);
}

function asArray(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function decodeHtml(value) {
  return String(value || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#038;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#8211;/g, '-')
    .replace(/&#8217;/g, "'");
}

function stripHtml(value) {
  return decodeHtml(value)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function textValue(value) {
  if (typeof value === 'string') return stripHtml(value);
  if (value && typeof value === 'object') {
    for (const key of ['#text', '#cdata-section', '__cdata', 'text', '@_href']) {
      if (typeof value[key] === 'string') return stripHtml(value[key]);
    }
    return Object.values(value).map(textValue).filter(Boolean).join(' ').trim();
  }
  return '';
}

function cleanSummary(value) {
  return stripHtml(value)
    .replace(/\s*\[\s*…\s*\]\s*The post\b[\s\S]*?appeared first on Container News\s*\.?\s*$/i, '')
    .replace(/\s*The post\b[\s\S]*?appeared first on Container News\s*\.?\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function attr(tag, name) {
  const match = String(tag || '').match(new RegExp(name + "=[\"']([^\"']*)[\"']", 'i'));
  return match ? decodeHtml(match[1]).trim() : '';
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function metaContent(html, attrName, key) {
  const attrPattern = escapeRegExp(attrName);
  const keyPattern = escapeRegExp(key);
  const patterns = [
    new RegExp('<meta\\b[^>]*' + attrPattern + '=["\\\']' + keyPattern + '["\\\'][^>]*content=["\\\']([^"\\\']*)["\\\']', 'i'),
    new RegExp('<meta\\b[^>]*content=["\\\']([^"\\\']*)["\\\'][^>]*' + attrPattern + '=["\\\']' + keyPattern + '["\\\']', 'i'),
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return stripHtml(match[1]);
  }
  return '';
}

function normalizeUrl(value, baseUrl = LIST_URL) {
  if (!value) return '';
  try {
    const url = new URL(decodeHtml(value).trim(), baseUrl);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    url.hash = '';
    url.search = '';
    return url.href;
  } catch (_) {
    return '';
  }
}

function parseDate(value) {
  const raw = textValue(value);
  if (!raw) return null;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return null;
  return {
    date: date.toISOString().slice(0, 10),
    published_at: date.toISOString(),
  };
}

async function fetchText(url, label) {
  const response = await fetch(url, {
    headers: HEADERS,
    redirect: 'follow',
    signal: AbortSignal.timeout(20000),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(label + ' HTTP ' + response.status);
  if (!text || text.length < 100) throw new Error(label + ' empty response');
  return { url: response.url, text };
}

function parseFeed(xml) {
  const parser = new XMLParser({
    ignoreAttributes: false,
    cdataPropName: '#text',
  });
  const parsed = parser.parse(xml);
  const channel = parsed?.rss?.channel || {};
  const channelTitle = textValue(channel.title);
  const rawItems = asArray(channel.item);
  if (!rawItems.length) throw new Error('RSS item not found');

  const items = [];
  for (const raw of rawItems) {
    const title = textValue(raw.title);
    const url = normalizeUrl(textValue(raw.link) || textValue(raw.guid));
    const parsedDate = parseDate(raw.pubDate);
    if (!title || !url || !parsedDate) continue;

    const categories = asArray(raw.category).map(textValue).filter(Boolean);
    const summary = cleanSummary(textValue(raw.description || raw['content:encoded'] || '')).slice(0, 1000);
    items.push({
      source: SOURCE,
      section: SECTION,
      title,
      url,
      date: parsedDate.date,
      author: textValue(raw['dc:creator'] || raw.creator),
      summary,
      categories,
      guid: textValue(raw.guid),
      published_at: parsedDate.published_at,
      summary_en: summary,
      language: 'en',
      feed_title: channelTitle,
    });
  }
  return dedupeItems(items);
}

function findBalancedDiv(html, openStart) {
  const tagRe = /<\/?div\b[^>]*>/gi;
  tagRe.lastIndex = openStart;
  let depth = 0;
  let match;
  while ((match = tagRe.exec(html))) {
    if (match[0].startsWith('</')) {
      depth -= 1;
      if (depth === 0) return html.slice(openStart, tagRe.lastIndex);
    } else {
      depth += 1;
    }
  }
  return '';
}

function extractCategoryBlocks(html) {
  const blocks = [];
  const blockRe = /<div\b[^>]*class=["'][^"']*\btd_block_wrap\b[^"']*\btdb-category-(?:grid|loop)-posts\b[^"']*["'][^>]*>/gi;
  let match;
  while ((match = blockRe.exec(html))) {
    const block = findBalancedDiv(html, match.index);
    if (block) blocks.push(block);
    if (block) blockRe.lastIndex = match.index + block.length;
  }
  return blocks;
}

function extractModuleCards(html) {
  const cards = [];
  const scopes = extractCategoryBlocks(html);
  const searchSpaces = scopes.length ? scopes : [html];
  const cardRe = /<div\b[^>]*class=["'][^"']*\btd-module-container\b[^"']*["'][^>]*>/gi;
  for (const scope of searchSpaces) {
    cardRe.lastIndex = 0;
    let match;
    while ((match = cardRe.exec(scope))) {
      const block = findBalancedDiv(scope, match.index);
      if (block) cards.push(block);
      if (block) cardRe.lastIndex = match.index + block.length;
      if (cards.length >= 80) break;
    }
    if (cards.length >= 80) break;
  }
  return cards;
}

function parseHtmlCard(block, pageUrl) {
  const titleMatch = block.match(/<h[1-6]\b[^>]*class=["'][^"']*\bentry-title\b[^"']*["'][^>]*>[\s\S]*?<a\b([^>]*)>([\s\S]*?)<\/a>/i);
  const timeMatch = block.match(/<time\b([^>]*)>([\s\S]*?)<\/time>/i);
  if (!titleMatch || !timeMatch) return null;

  const title = stripHtml(titleMatch[2]);
  const url = normalizeUrl(attr('<a ' + titleMatch[1] + '>', 'href'), pageUrl);
  const dateText = attr('<time ' + timeMatch[1] + '>', 'datetime') || stripHtml(timeMatch[2]);
  const parsedDate = parseDate(dateText);
  if (!title || !url || !parsedDate) return null;

  const author = stripHtml(
    block.match(/<(?:span|div)\b[^>]*class=["'][^"']*\btd-post-author-name\b[^"']*["'][^>]*>[\s\S]*?<a\b[^>]*>([\s\S]*?)<\/a>/i)?.[1] || '',
  );
  const categories = Array.from(block.matchAll(/<a\b[^>]*class=["'][^"']*\btd-post-category\b[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi))
    .map((match) => stripHtml(match[1]))
    .filter(Boolean);

  return {
    source: SOURCE,
    section: SECTION,
    title,
    url,
    date: parsedDate.date,
    author,
    summary: '',
    categories,
    published_at: parsedDate.published_at,
    summary_en: '',
    language: 'en',
  };
}

function parseHtmlList(html, pageUrl) {
  return dedupeItems(
    extractModuleCards(html)
      .map((block) => parseHtmlCard(block, pageUrl))
      .filter(Boolean),
  );
}

function mergeCategories(...groups) {
  const seen = new Set();
  const out = [];
  for (const value of groups.flat()) {
    const text = stripHtml(value);
    const key = text.toLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
}

function parseArticleMeta(html) {
  const published = metaContent(html, 'property', 'article:published_time');
  const parsedDate = published ? parseDate(published) : null;
  const categories = Array.from(html.matchAll(/<li\b[^>]*class=["'][^"']*\bentry-category\b[^"']*["'][^>]*>[\s\S]*?<a\b[^>]*>([\s\S]*?)<\/a>/gi))
    .map((match) => stripHtml(match[1]))
    .filter(Boolean);

  return {
    author: metaContent(html, 'name', 'author') || metaContent(html, 'name', 'twitter:data1'),
    summary: cleanSummary(metaContent(html, 'property', 'og:description') || metaContent(html, 'name', 'description')).slice(0, 1000),
    categories,
    date: parsedDate?.date,
    published_at: parsedDate?.published_at,
  };
}

async function enrichHtmlItems(items) {
  const enriched = [];
  for (const item of items) {
    if (item.author && item.summary && item.categories?.length) {
      enriched.push(item);
      continue;
    }

    try {
      const response = await fetchText(item.url, 'article meta');
      const meta = parseArticleMeta(response.text);
      const merged = {
        ...item,
        date: item.date || meta.date,
        author: item.author || meta.author,
        summary: item.summary || meta.summary || '',
        categories: mergeCategories(item.categories || [], meta.categories || []),
        published_at: item.published_at || meta.published_at,
        summary_en: item.summary_en || meta.summary || '',
      };
      if (!merged.title || !merged.url || !merged.date || !merged.author) {
        warn('HTML item skipped; required article metadata missing ' + item.url);
        continue;
      }
      enriched.push(merged);
    } catch (error) {
      warn('article metadata skipped ' + item.url, error);
    }
  }
  return enriched;
}

async function collectCandidates({ backfillPages = 0 } = {}) {
  if (backfillPages > 0) {
    const pages = Math.max(1, Math.min(Number(backfillPages) || 1, 25));
    const items = [];
    for (let page = 1; page <= pages; page += 1) {
      const url = page === 1 ? LIST_URL : LIST_URL + 'page/' + page + '/';
      try {
        const response = await fetchText(url, 'backfill page ' + page);
        items.push(...parseHtmlList(response.text, response.url));
      } catch (error) {
        warn('backfill page skipped ' + url, error);
      }
    }
    return { source: 'html-backfill', items: dedupeItems(items) };
  }

  try {
    const response = await fetchText(FEED_URL, 'RSS feed');
    return { source: 'rss', items: parseFeed(response.text) };
  } catch (error) {
    warn('RSS failed; falling back to HTML list', error);
  }

  try {
    const response = await fetchText(LIST_URL, 'HTML list');
    return { source: 'html', items: parseHtmlList(response.text, response.url) };
  } catch (error) {
    warn('HTML fallback failed', error);
    return { source: 'none', items: [] };
  }
}

function dedupeItems(items) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const key = normalizeUrl(item?.url || '');
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ ...item, url: key });
  }
  return out;
}

function emptyCache() {
  return {
    schema_version: CACHE_SCHEMA,
    fetched_at: '',
    seen_urls: [],
    items: [],
  };
}

function loadCache() {
  try {
    if (!fs.existsSync(CACHE_PATH)) return emptyCache();
    const raw = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf-8'));
    if (raw.schema_version !== CACHE_SCHEMA) return emptyCache();
    return {
      ...emptyCache(),
      ...raw,
      seen_urls: Array.isArray(raw.seen_urls) ? raw.seen_urls : [],
      items: Array.isArray(raw.items) ? raw.items : [],
    };
  } catch (error) {
    warn('cache read failed; starting empty', error);
    return emptyCache();
  }
}

function saveCache(cache) {
  try {
    const byUrl = new Map();
    for (const item of cache.items || []) {
      if (item?.url) byUrl.set(normalizeUrl(item.url), item);
    }
    const seen = new Set([
      ...(cache.seen_urls || []).map((url) => normalizeUrl(url)).filter(Boolean),
      ...byUrl.keys(),
    ]);
    const payload = {
      schema_version: CACHE_SCHEMA,
      fetched_at: new Date().toISOString(),
      seen_urls: Array.from(seen).sort(),
      items: Array.from(byUrl.values()).sort((a, b) => String(b.date).localeCompare(String(a.date))),
    };
    fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
    fs.writeFileSync(CACHE_PATH, JSON.stringify(payload, null, 2), 'utf-8');
  } catch (error) {
    warn('cache save failed', error);
  }
}

function getSupabaseClient() {
  if (process.env.CN_RS_DISABLE_SUPABASE === '1') return null;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  try {
    if (!globalThis.WebSocket) globalThis.WebSocket = require('ws');
    const { createClient } = require('@supabase/supabase-js');
    return createClient(url, key, { auth: { persistSession: false } });
  } catch (error) {
    warn('Supabase client unavailable', error);
    return null;
  }
}

async function existingUrlsInSupabase(urls) {
  const client = getSupabaseClient();
  if (!client || !urls.length) return new Set();

  const existing = new Set();
  const chunkSize = 100;
  for (let i = 0; i < urls.length; i += chunkSize) {
    const chunk = urls.slice(i, i + chunkSize);
    const { data, error } = await client
      .from('maritime_news')
      .select('url')
      .in('url', chunk);
    if (error) {
      warn('Supabase URL lookup failed', error);
      return existing;
    }
    for (const row of data || []) {
      if (row.url) existing.add(normalizeUrl(row.url));
    }
  }
  return existing;
}

async function persistToSupabase(items) {
  const client = getSupabaseClient();
  if (!client || !items.length) {
    if (!client && items.length) warn('Supabase env missing; local cache only');
    return;
  }

  const rows = items.map((item) => ({
    title: item.title.slice(0, 500),
    url: item.url,
    source: SOURCE,
    published_at: item.published_at,
    summary: item.summary ? item.summary.slice(0, 500) : null,
    content: null,
    lang: 'en',
    category: 'Rates & Surcharges',
    tags: ['rates-surcharges', ...(item.categories || [])],
    image_url: null,
    image_source: null,
    image_credit: null,
    agent_type: 'external',
    slug: null,
    fetched_at: new Date().toISOString(),
  }));

  const { error } = await client.from('maritime_news').upsert(rows, { onConflict: 'url' });
  if (error) warn('Supabase upsert failed', error);
  else console.log('[container-news-rates] Supabase upserted ' + rows.length + ' rows');
}

async function collectRatesSurcharges(options = {}) {
  try {
    const cache = loadCache();
    const result = await collectCandidates(options);
    const candidates = result.items;
    const localSeen = new Set((cache.seen_urls || []).map((url) => normalizeUrl(url)).filter(Boolean));
    const dbSeen = await existingUrlsInSupabase(candidates.map((item) => item.url));

    let fresh = candidates.filter((item) => {
      const key = normalizeUrl(item.url);
      return key && !localSeen.has(key) && !dbSeen.has(key);
    });

    if (!fresh.length) {
      console.log('[container-news-rates] source=' + result.source + ' candidates=' + candidates.length + ' new=0');
      return [];
    }

    if (result.source.startsWith('html')) {
      fresh = await enrichHtmlItems(fresh);
      if (!fresh.length) {
        console.log('[container-news-rates] source=' + result.source + ' candidates=' + candidates.length + ' new=0');
        return [];
      }
    }

    await persistToSupabase(fresh);
    saveCache({
      ...cache,
      items: [...(cache.items || []), ...fresh],
      seen_urls: [...(cache.seen_urls || []), ...fresh.map((item) => item.url)],
    });

    console.log('[container-news-rates] source=' + result.source + ' candidates=' + candidates.length + ' new=' + fresh.length);
    return fresh;
  } catch (error) {
    warn('collector failed', error);
    return [];
  }
}

async function collect(options = {}) {
  const items = await collectRatesSurcharges(options);
  return {
    section: 'shipping',
    data: items.map((item) => ({
      data_type: 'news',
      data_key: SOURCE + '_' + SECTION + '_' + item.url,
      data_value: item,
      source: SOURCE,
      source_url: item.url,
      is_complete: true,
    })),
  };
}

function parseBackfillArg(argv) {
  const eqArg = argv.find((arg) => arg.startsWith('--backfill='));
  if (eqArg) return Number(eqArg.split('=')[1]) || 5;
  const idx = argv.indexOf('--backfill');
  if (idx >= 0) return Number(argv[idx + 1]) || 5;
  return 0;
}

if (require.main === module) {
  collectRatesSurcharges({
    backfillPages: parseBackfillArg(process.argv.slice(2)),
  }).then((items) => {
    console.log(JSON.stringify(items, null, 2));
  }).catch((error) => {
    warn('standalone failed', error);
    process.exitCode = 0;
  });
}

module.exports = {
  CACHE_PATH,
  collect,
  collectRatesSurcharges,
  parseFeed,
  parseHtmlList,
};
