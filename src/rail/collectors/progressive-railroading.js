const cheerio = require('cheerio');

const RSS_URL = 'https://www.progressiverailroading.com/rss/prnews.asp';
const SOURCE = 'Progressive Railroading';
const CATEGORY = '\ucca0\ub3c4-\ubd81\ubbf8';
const UA = 'LogisightRailMonitor/0.1 (+research)';

function cleanText(value) {
  return (value || '')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripHtml(value) {
  return cleanText((value || '').replace(/<[^>]+>/g, ' '));
}

function parsePublishedAt(value) {
  if (!value) return null;
  const normalized = value.replace(/\bCST\b/i, '-0600');
  const date = new Date(normalized);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

async function fetchText(url, fetchImpl) {
  const response = await fetchImpl(url, { headers: { 'User-Agent': UA } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

function parseFeed(xml) {
  const $ = cheerio.load(xml, { xmlMode: true });
  const rows = [];
  $('item').each((_, element) => {
    const title = cleanText($(element).find('title').first().text());
    const url = cleanText($(element).find('link').first().text());
    const description = stripHtml($(element).find('description').first().text());
    const pubDate = cleanText($(element).find('pubDate').first().text());
    if (!title || !url) return;
    rows.push({ title, url, description, pubDate });
  });
  return rows;
}

async function enrichArticle(item, fetchImpl) {
  try {
    const html = await fetchText(item.url, fetchImpl);
    const $ = cheerio.load(html);
    const paragraphs = $('#article p')
      .map((_, paragraph) => cleanText($(paragraph).text()))
      .get()
      .filter((text) => text && !/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(text));
    const content = paragraphs.join('\n').trim();
    const summary = item.description || paragraphs[0] || '';
    return { summary: summary.slice(0, 600), content };
  } catch {
    return { summary: item.description.slice(0, 600), content: item.description };
  }
}

async function collectProgressiveRailroading({ supabase, fetchImpl = fetch } = {}) {
  const out = { source: 'progressive-railroading', read: 0, inserted: 0, errors: [] };
  if (!supabase) {
    out.errors.push('missing supabase client');
    return out;
  }

  let xml;
  try {
    xml = await fetchText(RSS_URL, fetchImpl);
  } catch (error) {
    out.errors.push(`rss fetch: ${error.message}`);
    return out;
  }

  const items = parseFeed(xml);
  out.read = items.length;

  const urls = items.map((item) => item.url);
  const { data: existing, error: existingError } = await supabase
    .from('maritime_news')
    .select('url')
    .in('url', urls.length ? urls : ['__none__']);
  if (existingError) {
    out.errors.push(`existing read: ${JSON.stringify(existingError)}`);
    return out;
  }

  const seen = new Set((existing ?? []).map((row) => row.url));
  const freshItems = items.filter((item) => !seen.has(item.url));
  const now = new Date().toISOString();
  const rows = [];
  for (const item of freshItems) {
    const article = await enrichArticle(item, fetchImpl);
    rows.push({
      title: item.title,
      url: item.url,
      summary: article.summary || null,
      content: article.content || article.summary || null,
      source: SOURCE,
      category: CATEGORY,
      lang: 'en',
      agent_type: 'external',
      is_hero: false,
      tags: ['rail', 'north-america'],
      published_at: parsePublishedAt(item.pubDate),
      fetched_at: now,
    });
  }

  if (rows.length) {
    const { error } = await supabase.from('maritime_news').upsert(rows, { onConflict: 'url', ignoreDuplicates: false });
    if (error) {
      out.errors.push(`upsert: ${JSON.stringify(error)}`);
      return out;
    }
  }

  out.inserted = rows.length;
  return out;
}

module.exports = { collectProgressiveRailroading, RSS_URL, CATEGORY };
