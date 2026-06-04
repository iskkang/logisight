// HTML news collector for the shared air/trade source registry.

import { chromium, type Browser, type Page } from 'playwright';

import { sourcesFor, type NewsSource } from './news_sources';
import type { CollectorResult, NewsItem } from './types';
import { enrichNewsItem, persistCollectedNews } from './utils/news_enrichment';
import { rateLimited } from './utils/rate_limiter';
import { snapshotWriter } from './utils/snapshot_writer';

async function scrapePage(page: Page, source: NewsSource): Promise<NewsItem[]> {
  await page.goto(source.url, { waitUntil: 'domcontentloaded', timeout: 25000 });
  const rows = await page.evaluate((selector) => {
    const seen = new Set<string>();
    return Array.from(document.querySelectorAll(selector))
      .map((anchor) => {
        const container = anchor.closest('article, li, tr, .post, .news-item');
        const time = container?.querySelector('time');
        return {
          title: (anchor.textContent || '').trim().replace(/\s+/g, ' '),
          url: (anchor as HTMLAnchorElement).href || '',
          date: time?.getAttribute('datetime') || time?.textContent?.trim() || null,
        };
      })
      .filter((item) => {
        if (item.title.length < 8 || item.title.length > 200 || !/^https?:\/\//.test(item.url)) return false;
        if (seen.has(item.url)) return false;
        seen.add(item.url);
        return true;
      })
      .slice(0, 8);
  }, source.selector || 'article a, h2 a, h3 a');

  return rows.map((row) => {
    const date = row.date ? new Date(row.date) : null;
    return {
      title: row.title,
      url: row.url,
      published_at: date && !Number.isNaN(date.getTime()) ? date.toISOString() : null,
      summary_en: '',
      source: source.name,
    };
  });
}

export async function collect(): Promise<CollectorResult> {
  const result: CollectorResult = { section: 'trade', data: [] };
  let browser: Browser | null = null;

  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const sources = sourcesFor(['air', 'trade'], 'html');
    for (const source of sources) {
      try {
        const items = await rateLimited(source.url, () => scrapePage(page, source));
        const enriched = await Promise.all(items.map(enrichNewsItem));
        for (const item of enriched) {
          result.data.push({
            data_type: 'news',
            data_key: `${source.name}_${item.url}`,
            data_value: {
              ...item,
              section: source.section,
              language: source.language,
            },
            source: source.name,
            source_url: source.url,
            is_complete: true,
          });
        }
        console.log(`✅ ${source.name}: ${enriched.length}건`);
      } catch (error) {
        console.error(`❌ ${source.name}:`, (error as Error).message);
      }
    }
  } finally {
    if (browser) await browser.close();
  }

  await persistCollectedNews(result).catch((error) =>
    console.warn('[maritime_news] Supabase persist skipped:', (error as Error).message),
  );
  return result;
}

if (require.main === module) {
  collect().then(snapshotWriter).catch(console.error);
}
