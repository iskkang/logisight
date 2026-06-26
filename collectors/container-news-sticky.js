'use strict';

const fs = require('fs');
const path = require('path');

const SOURCE = 'container-news';
const SECTION = 'rail';
const HOME_URL = 'https://container-news.com/';
const OUT_OF_BOX_URL = 'https://container-news.com/category/out-of-the-box/';
const CACHE_PATH = path.resolve(__dirname, '../outputs/cache/container-news-sticky.json');
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const CACHE_SCHEMA = 1;

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

const RAIL_KEYWORDS = [
  'KTZ',
  'TITR',
  'Trans-Caspian',
  'Middle Corridor',
  'TCR',
  'TSR',
  'RZD',
  'China Railway',
  'China-Europe',
  'Eurasian',
  'Khorgos',
  'Dostyk',
  'Aktau',
  'Baku',
  'Tbilisi',
  'Poti',
  'block train',
  'rail freight',
  'intermodal rail',
  'rail corridor',
  'landbridge',
];

function warn(message, error) {
  const suffix = error && error.message ? ': ' + error.message : '';
  console.warn('[container-news-sticky] ' + message + suffix);
}

function decodeHtml(value) {
  return String(value || '')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function stripHtml(value) {
  return decodeHtml(value)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function attr(tag, name) {
  const pattern = new RegExp(name + "=[\"']([^\"']*)[\"']", 'i');
  const match = String(tag || '').match(pattern);
  return match ? decodeHtml(match[1]).trim() : '';
}

function firstTag(block) {
  return String(block || '').match(/<(article|div)\b[^>]*>/i)?.[0] || '';
}

function classList(block) {
  return attr(firstTag(block), 'class').split(/\s+/).filter(Boolean);
}

function normalizeText(value) {
  return stripHtml(value).toLowerCase().replace(/\s+/g, ' ').trim();
}

function findBalancedElement(html, openStart, tagName) {
  const tagRe = new RegExp('</?' + tagName + '\\b[^>]*>', 'gi');
  tagRe.lastIndex = openStart;
  let depth = 0;
  let match;
  while ((match = tagRe.exec(html))) {
    if (match[0].startsWith('</')) {
      depth -= 1;
      if (depth === 0) {
        return {
          start: openStart,
          end: tagRe.lastIndex,
          block: html.slice(openStart, tagRe.lastIndex),
        };
      }
    } else {
      depth += 1;
    }
  }
  return null;
}

function extractElementsByOpenTag(html, openTagRe, limit) {
  const blocks = [];
  let match;
  openTagRe.lastIndex = 0;
  while ((match = openTagRe.exec(html))) {
    const tagName = match[1] || 'div';
    const found = findBalancedElement(html, match.index, tagName.toLowerCase());
    if (!found) continue;
    blocks.push(found.block);
    openTagRe.lastIndex = found.end;
    if (limit && blocks.length >= limit) break;
  }
  return blocks;
}

function extractTopLevelBlocks(html) {
  return extractElementsByOpenTag(
    html,
    /<(div)\b[^>]*class=["'][^"']*\btd_block_wrap\b[^"']*["'][^>]*>/gi,
    50,
  );
}

function extractBlockTitle(block) {
  const titleWrap = block.match(/<div\b[^>]*class=["'][^"']*\btd-block-title-wrap\b[^"']*["'][^>]*>[\s\S]*?<\/div>/i)?.[0]
    || block.match(/<h[1-6]\b[^>]*class=["'][^"']*\bblock-title\b[^"']*["'][^>]*>[\s\S]*?<\/h[1-6]>/i)?.[0]
    || '';
  return stripHtml(titleWrap);
}

function absoluteUrl(value, pageUrl) {
  if (!value) return null;
  try {
    const url = new URL(decodeHtml(value).trim(), pageUrl);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    url.hash = '';
    return url.href;
  } catch (_) {
    return null;
  }
}

function isArticleUrl(url) {
  if (!url || !url.startsWith('https://container-news.com/')) return false;
  return !/\/(?:author|category|tag|page|login|contact|privacy|terms|about|advertise|freight-news|port-news|services|interviews|out-of-the-box|cn-index|cn-magazine)\/?$/i.test(url);
}

function extractLinksFromBlock(block, pageUrl) {
  const links = [];
  const seen = new Set();
  for (const match of block.matchAll(/<a\b[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const openTag = match[0].match(/<a\b[^>]*>/i)?.[0] || '';
    const url = absoluteUrl(match[1], pageUrl);
    if (!isArticleUrl(url) || seen.has(url)) continue;

    const title = attr(openTag, 'title') || stripHtml(match[2]);
    if (title.length < 10 || title.length > 220) continue;

    seen.add(url);
    links.push({ title, url });
  }
  return links;
}

function extractStandardStickyBlocks(html) {
  const articleBlocks = extractElementsByOpenTag(html, /<(article)\b[^>]*>/gi, 80);
  const postBlocks = extractElementsByOpenTag(html, /<(div)\b[^>]*class=["'][^"']*(?:\bsticky\b|Sticky News)[^"']*["'][^>]*>/gi, 80);
  return [...articleBlocks, ...postBlocks].filter((block) => {
    const hasClass = classList(block).some((name) => name.toLowerCase() === 'sticky');
    const hasBadge = /Sticky News/i.test(stripHtml(block));
    return hasClass || hasBadge;
  });
}

function extractStickyLinks(html, pageUrl) {
  const standardBlocks = extractStandardStickyBlocks(html);
  if (standardBlocks.length) {
    return {
      signal: 'standard-sticky-class-or-badge',
      links: dedupeLinks(standardBlocks.flatMap((block) => extractLinksFromBlock(block, pageUrl))),
    };
  }

  const dontMissBlocks = extractTopLevelBlocks(html).filter((block) => {
    return normalizeText(extractBlockTitle(block)) === "don't miss";
  });

  return {
    signal: dontMissBlocks.length ? 'home-dont-miss-block' : 'none',
    links: dedupeLinks(dontMissBlocks.flatMap((block) => extractLinksFromBlock(block, pageUrl))),
  };
}

function dedupeLinks(links) {
  const seen = new Set();
  return links.filter((link) => {
    if (!link.url || seen.has(link.url)) return false;
    seen.add(link.url);
    return true;
  });
}

function metaContent(html, key, attrName) {
  const patterns = [
    new RegExp("<meta[^>]+(?:" + attrName + ")=[\"']" + key + "[\"'][^>]+content=[\"']([^\"']+)[\"']", 'i'),
    new RegExp("<meta[^>]+content=[\"']([^\"']+)[\"'][^>]+(?:" + attrName + ")=[\"']" + key + "[\"']", 'i'),
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return decodeHtml(match[1]).trim();
  }
  return '';
}

function parseDate(html) {
  const candidates = [
    metaContent(html, 'article:published_time', 'property'),
    html.match(/<time\b[^>]*datetime=["']([^"']+)["'][^>]*>/i)?.[1] || '',
    stripHtml(html.match(/<time\b[^>]*>([\s\S]*?)<\/time>/i)?.[1] || ''),
  ].filter(Boolean);

  for (const candidate of candidates) {
    const date = new Date(candidate);
    if (!Number.isNaN(date.getTime())) {
      return {
        date: date.toISOString().slice(0, 10),
        published_at: date.toISOString(),
      };
    }
  }
  return null;
}

function extractContentBlock(html) {
  const match = html.match(/<div\b[^>]*class=["'][^"']*\btd-post-content\b[^"']*["'][^>]*>/i);
  if (!match) return '';
  const found = findBalancedElement(html, match.index, 'div');
  return found ? found.block : '';
}

function extractParagraphSummary(contentBlock) {
  const paragraphs = [];
  for (const match of contentBlock.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)) {
    const text = stripHtml(match[1]);
    if (text.length >= 30) paragraphs.push(text);
    if (paragraphs.length >= 3) break;
  }
  return paragraphs.join(' ').slice(0, 700).trim();
}

function extractTags(html) {
  const sourceTags = html.match(/<div\b[^>]*class=["'][^"']*\btd-post-source-tags\b[^"']*["'][^>]*>[\s\S]*?<\/div>/i)?.[0] || '';
  const tags = [];
  for (const match of sourceTags.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi)) {
    const tag = stripHtml(match[1]);
    if (tag && !tags.includes(tag)) tags.push(tag);
  }
  return tags;
}

function parseArticle(html, url, fallbackTitle) {
  const title = stripHtml(html.match(/<h1\b[^>]*class=["'][^"']*\bentry-title\b[^"']*["'][^>]*>([\s\S]*?)<\/h1>/i)?.[1] || '')
    || metaContent(html, 'og:title', 'property').replace(/ - Container News$/i, '')
    || fallbackTitle;
  const parsedDate = parseDate(html);
  const contentBlock = extractContentBlock(html);
  const content = stripHtml(contentBlock).slice(0, 2500);
  const summary = extractParagraphSummary(contentBlock)
    || metaContent(html, 'description', 'name')
    || content.slice(0, 700).trim();
  const tags = extractTags(html);

  if (!title || !url || !parsedDate || !summary) return null;

  return {
    source: SOURCE,
    section: SECTION,
    sticky: true,
    title,
    url,
    date: parsedDate.date,
    summary,
    tags,
    published_at: parsedDate.published_at,
    summary_en: summary,
    content,
    language: 'en',
    category: 'deep_analysis',
  };
}

function isRailRelevant(item) {
  const haystack = [item.title, item.summary, ...(item.tags || [])].join(' ').toLowerCase();
  return RAIL_KEYWORDS.some((keyword) => haystack.includes(keyword.toLowerCase()));
}

function isFresh(raw) {
  if (!raw || raw.schema_version !== CACHE_SCHEMA || !raw.fetched_at) return false;
  const age = Date.now() - new Date(raw.fetched_at).getTime();
  return age >= 0 && age <= CACHE_TTL_MS;
}

function loadCache({ allowStale = false } = {}) {
  try {
    if (!fs.existsSync(CACHE_PATH)) return null;
    const raw = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf-8'));
    if (raw.schema_version !== CACHE_SCHEMA) return null;
    if (!allowStale && !isFresh(raw)) return null;
    return raw;
  } catch (_) {
    return null;
  }
}

function saveCache(payload) {
  try {
    fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
    fs.writeFileSync(
      CACHE_PATH,
      JSON.stringify({ schema_version: CACHE_SCHEMA, fetched_at: new Date().toISOString(), ...payload }, null, 2),
      'utf-8',
    );
  } catch (error) {
    warn('cache save skipped', error);
  }
}

async function fetchHtml(url, label) {
  const response = await fetch(url, {
    headers: HEADERS,
    redirect: 'follow',
    signal: AbortSignal.timeout(20000),
  });
  const html = await response.text();
  if (!response.ok) throw new Error(label + ' HTTP ' + response.status);
  if (!html || html.length < 1000) throw new Error(label + ' empty HTML');
  return { url: response.url, html };
}

async function scrapeFresh() {
  let home = null;
  let outOfBox = null;

  try {
    home = await fetchHtml(HOME_URL, 'home');
  } catch (error) {
    warn('home fetch failed', error);
  }

  try {
    outOfBox = await fetchHtml(OUT_OF_BOX_URL, 'out-of-the-box');
  } catch (error) {
    warn('out-of-the-box fetch failed', error);
  }

  if (!home) throw new Error('home HTML unavailable');

  const sticky = extractStickyLinks(home.html, home.url);
  if (sticky.signal === 'none') {
    warn('sticky signal not found; returning empty list');
    return { items: [], sticky_signal: sticky.signal, source_urls: [home.url, outOfBox?.url].filter(Boolean) };
  }

  const railItems = [];
  let articleFailures = 0;
  for (const link of sticky.links) {
    try {
      const detail = await fetchHtml(link.url, link.title);
      const article = parseArticle(detail.html, detail.url, link.title);
      if (!article) continue;
      if (isRailRelevant(article)) railItems.push(article);
    } catch (error) {
      articleFailures += 1;
      warn('article skipped ' + link.url, error);
    }
  }

  if (sticky.links.length > 0 && articleFailures === sticky.links.length) {
    throw new Error('all sticky article detail fetches failed');
  }

  return {
    items: dedupeItems(railItems),
    sticky_signal: sticky.signal,
    source_urls: [home.url, outOfBox?.url].filter(Boolean),
  };
}

function dedupeItems(items) {
  const seen = new Set();
  return items.filter((item) => {
    if (!item.url || seen.has(item.url)) return false;
    seen.add(item.url);
    return true;
  });
}

async function collectStickyRailNews(options = {}) {
  try {
    if (!options.force) {
      const cached = loadCache();
      if (cached) {
        console.log('[container-news-sticky] cache hit ' + cached.fetched_at.slice(0, 10) + ' items=' + cached.items.length);
        return cached.items;
      }
    }

    const fresh = await scrapeFresh();
    saveCache(fresh);
    console.log('[container-news-sticky] fetched items=' + fresh.items.length + ' signal=' + fresh.sticky_signal);
    return fresh.items;
  } catch (error) {
    warn('fresh scrape failed', error);
    const cached = loadCache({ allowStale: true });
    if (cached) {
      warn('using stale cache from ' + cached.fetched_at);
      return cached.items || [];
    }
    return [];
  }
}

async function collect(options = {}) {
  try {
    const items = await collectStickyRailNews(options);
    return {
      section: SECTION,
      data: items.map((item) => ({
        data_type: 'news',
        data_key: SOURCE + '_sticky_' + item.url,
        data_value: item,
        source: SOURCE,
        source_url: item.url,
        is_complete: true,
      })),
    };
  } catch (error) {
    warn('collector failed', error);
    return { section: SECTION, data: [] };
  }
}

if (require.main === module) {
  collectStickyRailNews({ force: process.argv.includes('--force') })
    .then((items) => {
      console.log(JSON.stringify(items, null, 2));
    })
    .catch((error) => {
      warn('standalone failed', error);
      process.exitCode = 0;
    });
}

module.exports = {
  CACHE_PATH,
  RAIL_KEYWORDS,
  collect,
  collectStickyRailNews,
  extractStickyLinks,
  isRailRelevant,
};
