// collectors/rail_tcr.ts
// ì¤‘êµ­-ìœ ëŸ½ ì² ë„ (TCR/BRI) ìˆ˜ì§‘ê¸° â€” fetch+RSS ê¸°ë°˜, PlaywrightëŠ” TransportCorridorsë§Œ
// ëŒ€ìƒ: RailFreight BRI RSS, Silk Road Briefing, Kazakhstan Today,
//       China Daily RSS, Global Times RSS, TransportCorridors (Playwright)

import { chromium, type Browser } from 'playwright';
import { rateLimited } from './utils/rate_limiter';
import { snapshotWriter } from './utils/snapshot_writer';
import type { CollectorResult, NewsItem } from './types';

const BOT_HEADERS = {
  'User-Agent': 'Logisight/1.0 (logisight.mtlship.com; bot)',
  'Accept-Language': 'en-US,en;q=0.9',
};

// â”€â”€ ê³µí†µ: RSS íŒŒì‹± â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function parseRss(
  rssUrl: string,
  sourceName: string,
  keywordFilter?: string[],
): Promise<NewsItem[]> {
  const res = await fetch(rssUrl, {
    headers: BOT_HEADERS,
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();

  const items: NewsItem[] = [];
  for (const m of text.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const b = m[1];
    const title = (
      b.match(/<title><!\[CDATA\[(.*?)\]\]>/)?.[1] ||
      b.match(/<title>(.*?)<\/title>/)?.[1] ||
      ''
    ).trim();
    const link = (b.match(/<link>(.*?)<\/link>/)?.[1] || '').trim();
    const pubDate = b.match(/<pubDate>(.*?)<\/pubDate>/)?.[1] || '';

    if (!title || !link) continue;
    if (keywordFilter) {
      const lower = title.toLowerCase();
      if (!keywordFilter.some(kw => lower.includes(kw))) continue;
    }

    items.push({
      title,
      url: link,
      published_at: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString(),
      summary_en: '',
      source: sourceName,
    });
    if (items.length >= 5) break;
  }
  return items;
}

// â”€â”€ ê³µí†µ: fetch HTML ë§í¬ íŒŒì‹± â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function fetchHtmlLinks(pageUrl: string, sourceName: string, max = 5): Promise<NewsItem[]> {
  const res = await fetch(pageUrl, {
    headers: BOT_HEADERS,
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();

  const base = new URL(pageUrl).origin;
  const items: NewsItem[] = [];
  const seen = new Set<string>();

  for (const m of html.matchAll(/<a[^>]+href="([^"]+)"[^>]*>([^<]{10,120})<\/a>/g)) {
    let href = m[1].trim();
    const title = m[2].trim().replace(/\s+/g, ' ');

    if (!href || href.startsWith('javascript') || href.startsWith('#') || href.startsWith('mailto')) continue;
    if (seen.has(title)) continue;
    if (href.startsWith('/')) href = `${base}${href}`;
    if (!href.startsWith('http')) continue;

    seen.add(title);
    items.push({
      title,
      url: href,
      published_at: new Date().toISOString(),
      summary_en: '',
      source: sourceName,
    });
    if (items.length >= max) break;
  }
  return items;
}

// â”€â”€ TransportCorridors (Playwright ìœ ì§€) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function fetchTransportCorridors(browser: Browser): Promise<NewsItem[]> {
  const url = 'https://www.transportcorridors.com/category/regions/central-asia';
  const page = await browser.newPage();
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });

    const items = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll('article a, h2 a, .post-title a'));
      const seen = new Set<string>();
      return links
        .map(a => ({
          title: (a as HTMLElement).textContent?.trim() || '',
          url: (a as HTMLAnchorElement).href || '',
        }))
        .filter(item => {
          if (item.title.length < 8 || item.title.length > 120) return false;
          if (!item.url || item.url.includes('#')) return false;
          if (seen.has(item.title)) return false;
          seen.add(item.title);
          return true;
        })
        .slice(0, 5);
    });

    return items.map(item => ({
      ...item,
      published_at: new Date().toISOString(),
      summary_en: '',
      source: 'TransportCorridors',
    }));
  } catch (e) {
    console.log(`âš ï¸ TransportCorridors ì‹¤íŒ¨: ${(e as Error).message}`);
    return [];
  } finally {
    await page.close();
  }
}

export async function collect(): Promise<CollectorResult> {
  const result: CollectorResult = { section: 'rail', data: [] };

  // â”€â”€ 1. fetch/RSS ì†ŒìŠ¤ ë³‘ë ¬ ìˆ˜ì§‘ â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const FETCH_SOURCES = [
    {
      label: 'RailFreight BRI',
      domain: 'https://www.railfreight.com',
      category: 'bri_rail',
      fn: () => parseRss(
        'https://www.railfreight.com/category/beltandroad/feed/',
        'RailFreight',
      ),
    },
    {
      label: 'Silk Road Briefing',
      domain: 'https://www.silkroadbriefing.com',
      category: 'bri_rail',
      fn: () => fetchHtmlLinks(
        'https://www.silkroadbriefing.com/news/category/china-belt-and-road/',
        'Silk Road Briefing',
      ),
    },
    {
      label: 'Kazakhstan Today',
      domain: 'https://kaztag.kz',
      category: 'central_asia',
      fn: () => fetchHtmlLinks('https://kaztag.kz/en/', 'Kazakhstan Today'),
    },
    {
      label: 'China Daily BRI',
      domain: 'https://www.chinadailyhk.com',
      category: 'bri_rail',
      fn: () => parseRss(
        'https://www.chinadailyhk.com/rss/bizchina.xml',
        'China Daily',
      ),
    },
    {
      label: 'Global Times RSS (railway/BRI)',
      domain: 'https://www.globaltimes.cn',
      category: 'bri_rail',
      fn: () => parseRss(
        'https://www.globaltimes.cn/rss/outbrain.xml',
        'Global Times',
        ['railway', 'belt and road', 'bri', 'silk road', 'china-europe', 'cre'],
      ),
    },
  ] as const;

  const settled = await Promise.allSettled(
    FETCH_SOURCES.map(s => rateLimited(s.domain, s.fn))
  );

  for (let i = 0; i < FETCH_SOURCES.length; i++) {
    const src = FETCH_SOURCES[i];
    const res = settled[i];
    if (res.status === 'rejected') {
      console.log(`âš ï¸ ${src.label} ì‹¤íŒ¨: ${(res.reason as Error).message}`);
      continue;
    }
    for (const item of res.value) {
      result.data.push({
        data_type: 'news',
        data_key: `RAIL_${i}_${Date.now()}`,
        data_value: { ...item, section: 'rail', language: 'en', category: src.category },
        source: item.source,
        source_url: item.url,
        is_complete: true,
      });
    }
    console.log(`âœ… ${src.label}: ${res.value.length}ê±´`);
  }

  // â”€â”€ 2. TransportCorridors (Playwright) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  let browser: Browser | null = null;
  try {
    browser = await chromium.launch({ headless: true });
    const items = await rateLimited(
      'https://www.transportcorridors.com',
      () => fetchTransportCorridors(browser!),
    );
    for (const item of items) {
      result.data.push({
        data_type: 'news',
        data_key: `TITR_${Date.now()}`,
        data_value: { ...item, section: 'rail', language: 'en', category: 'central_asia' },
        source: 'TransportCorridors',
        source_url: 'https://www.transportcorridors.com',
        is_complete: true,
      });
    }
    console.log(`âœ… TransportCorridors: ${items.length}ê±´`);
  } catch (e) {
    console.error('âŒ TransportCorridors:', (e as Error).message);
  } finally {
    if (browser) await browser.close();
  }

  const success = result.data.filter(d => d.is_complete).length;
  console.log(`\nâœ… rail_tcr: ì´ ${result.data.length}ê±´ ì¤‘ ${success}ê±´ ìˆ˜ì§‘ ì™„ë£Œ`);

  return result;
}

if (require.main === module) {
  collect().then(r => snapshotWriter(r)).catch(console.error);
}
