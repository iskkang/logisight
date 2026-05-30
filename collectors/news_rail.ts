// collectors/news_rail.ts
// CISÂ·ëŸ¬ì‹œì•„Â·ì² ë„ ë‰´ìŠ¤ ìˆ˜ì§‘ê¸°
// ëŒ€ìƒ: PortNews(EN), RailFreight, TransportCorridors, Deliver-2, Vgudok

import { chromium, type Browser, type Page } from 'playwright';
import { rateLimited } from './utils/rate_limiter';
import type { CollectorResult, NewsItem } from './types';

const RSS_SOURCES = [
  {
    name: 'RailFreight',
    rss: 'https://www.railfreight.com/feed/',
    section: 'rail' as const,
  },
  {
    name: 'RailFreight BeltAndRoad',
    rss: 'https://www.railfreight.com/category/beltandroad/feed/',
    section: 'rail' as const,
  },
];

const SCRAPE_SOURCES = [
  {
    name: 'PortNews EN',
    url: 'https://en.portnews.ru/news/',
    section: 'shipping' as const,
    listSelector: '.news-list__item a, .news-item a, h2 a, h3 a',
  },
  {
    name: 'TransportCorridors CentralAsia',
    url: 'https://www.transportcorridors.com/category/regions/central-asia',
    section: 'rail' as const,
    listSelector: 'article a, .post-title a, h2 a',
  },
  {
    name: 'TransportCorridors Rail',
    url: 'https://www.transportcorridors.com/category/modalities/rail-freight-en',
    section: 'rail' as const,
    listSelector: 'article a, .post-title a, h2 a',
  },
  {
    name: 'Deliver-2',
    url: 'https://deliver-2.com/news/',
    section: 'rail' as const,
    listSelector: '.news-item a, article a, h2 a, h3 a',
  },
];

async function parseRss(url: string, sourceName: string): Promise<NewsItem[]> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Logisight/1.0 (logisight.mtlship.com; news-bot)' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  const items: NewsItem[] = [];
  const matches = text.matchAll(/<item>([\s\S]*?)<\/item>/g);

  for (const m of matches) {
    const b = m[1];
    const title = (b.match(/<title><!\[CDATA\[(.*?)\]\]>/)?.[1] || b.match(/<title>(.*?)<\/title>/)?.[1] || '').trim();
    const link = (b.match(/<link>(.*?)<\/link>/)?.[1] || '').trim();
    if (title && link) {
      // ìˆ˜ì§‘ ì‹œì ì„ published_atìœ¼ë¡œ ì‚¬ìš© â€” RSS pubDateëŠ” ê³¼ê±° ë‚ ì§œì¼ ìˆ˜ ìžˆì–´
      // íë ˆì´ì…˜ window í•„í„°ë¥¼ í†µê³¼í•˜ë ¤ë©´ í•­ìƒ ì˜¤ëŠ˜ ë‚ ì§œì—¬ì•¼ í•¨
      items.push({
        title, url: link,
        published_at: new Date().toISOString(),
        summary_en: '',
        source: sourceName,
      });
    }
    if (items.length >= 5) break;
  }
  return items;
}

async function scrapePage(page: Page, source: typeof SCRAPE_SOURCES[0]): Promise<NewsItem[]> {
  await page.goto(source.url, { waitUntil: 'domcontentloaded', timeout: 25000 });

  const items = await page.evaluate((selector) => {
    const links = Array.from(document.querySelectorAll(selector));
    const seen = new Set<string>();
    return links
      .map(a => ({
        title: (a as HTMLElement).textContent?.trim() || '',
        url: (a as HTMLAnchorElement).href || '',
      }))
      .filter(item => {
        if (item.title.length < 10 || item.title.length > 150) return false;
        if (!item.url || item.url.includes('#') || item.url.includes('javascript')) return false;
        if (seen.has(item.title)) return false;
        seen.add(item.title);
        return true;
      })
      .slice(0, 5);
  }, source.listSelector);

  return items.map(item => ({
    ...item,
    published_at: new Date().toISOString(),
    summary_en: '',
    source: source.name,
  }));
}

import { snapshotWriter } from './utils/snapshot_writer';

export async function collect(): Promise<CollectorResult> {
  const result: CollectorResult = { section: 'rail', data: [] };
  let browser: Browser | null = null;

  try {
    // 1. RSS ìˆ˜ì§‘
    for (const src of RSS_SOURCES) {
      try {
        const items = await rateLimited(src.rss, () => parseRss(src.rss, src.name));
        for (const item of items) {
          result.data.push({
            data_type: 'news',
            data_key: `${src.name}_${Date.now()}`,
            data_value: { ...item, section: src.section, language: 'en' },
            source: src.name,
            source_url: src.rss,
            is_complete: true,
          });
        }
        console.log(`âœ… ${src.name}: ${items.length}ê±´`);
      } catch (e) {
        console.error(`âŒ ${src.name}:`, (e as Error).message);
        result.data.push({
          data_type: 'news', data_key: `${src.name}_error`, data_value: {},
          source: src.name, source_url: src.rss, is_complete: false,
          error_message: (e as Error).message,
        });
      }
    }

    // 2. ìŠ¤í¬ëž˜í•‘
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.setExtraHTTPHeaders({
      'User-Agent': 'Logisight/1.0 (logisight.mtlship.com; news-bot)',
    });

    for (const src of SCRAPE_SOURCES) {
      try {
        const items = await rateLimited(src.url, () => scrapePage(page, src));
        for (const item of items) {
          result.data.push({
            data_type: 'news',
            data_key: `${src.name}_${Date.now()}`,
            data_value: { ...item, section: src.section, language: 'en' },
            source: src.name,
            source_url: src.url,
            is_complete: true,
          });
        }
        console.log(`âœ… ${src.name}: ${items.length}ê±´`);
      } catch (e) {
        console.error(`âŒ ${src.name}:`, (e as Error).message);
        result.data.push({
          data_type: 'news', data_key: `${src.name}_error`, data_value: {},
          source: src.name, source_url: src.url, is_complete: false,
          error_message: (e as Error).message,
        });
      }
    }
  } finally {
    if (browser) await browser.close();
  }

  return result;
}

if (require.main === module) {
  collect().then(r => snapshotWriter(r)).catch(console.error);
}
