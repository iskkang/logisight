// Rail news collector. Sources are shared with monthly analysis.

import { chromium, type Browser, type Page } from 'playwright';

import { sourcesFor, type NewsSource } from './news_sources';
import type { CollectorResult, NewsItem } from './types';
import {
  enrichNewsItem,
  parseNewsFeed,
  persistCollectedNews,
} from './utils/news_enrichment';
import { rateLimited } from './utils/rate_limiter';
import { snapshotWriter } from './utils/snapshot_writer';

async function scrapePage(page: Page, source: NewsSource): Promise<NewsItem[]> {
  await page.goto(source.url, { waitUntil: 'domcontentloaded', timeout: 25000 });
  const items = await page.evaluate((selector) => {
    const seen = new Set<string>();
    return Array.from(document.querySelectorAll(selector))
      .map((anchor) => {
        const container = anchor.closest('article, li, tr, .post, .news-item');
        const dateElement = container?.querySelector('time');
        return {
          title: (anchor.textContent || '').trim().replace(/\s+/g, ' '),
          url: (anchor as HTMLAnchorElement).href || '',
          published_at: dateElement?.getAttribute('datetime') || dateElement?.textContent?.trim() || null,
        };
      })
      .filter((item) => {
        if (item.title.length < 10 || item.title.length > 200) return false;
        // 스킴 접두어만 보면 <a href="https://javascript:void(0);"> 같은 값이 통과해
        // 사이트에서 깨진 리다이렉트가 된다 — 실제 파싱 + 호스트 형태까지 확인
        try {
          const u = new URL(item.url);
          if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
          if (!u.hostname.includes('.')) return false;
        } catch {
          return false;
        }
        if (seen.has(item.url)) return false;
        seen.add(item.url);
        return true;
      })
      .slice(0, 8);
  }, source.selector || 'article a, h2 a, h3 a');

  return items.map((item) => {
    const date = item.published_at ? new Date(item.published_at) : null;
    return {
      title: item.title,
      url: item.url,
      published_at: date && !Number.isNaN(date.getTime()) ? date.toISOString() : null,
      summary_en: '',
      source: source.name,
    };
  });
}

export async function collect(): Promise<CollectorResult> {
  const result: CollectorResult = { section: 'rail', data: [] };
  let browser: Browser | null = null;

  try {
    for (const source of sourcesFor(['rail'], 'rss')) {
      try {
        const items = await rateLimited(source.url, () => parseNewsFeed(source));
        const enriched = await Promise.all(items.map(enrichNewsItem));
        for (const item of enriched) {
          result.data.push({
            data_type: 'news',
            data_key: `${source.name}_${item.url}`,
            data_value: { ...item, section: 'rail', language: source.language },
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

    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    for (const source of sourcesFor(['rail'], 'html')) {
      try {
        const items = await rateLimited(source.url, () => scrapePage(page, source));
        const enriched = await Promise.all(items.map(enrichNewsItem));
        for (const item of enriched) {
          result.data.push({
            data_type: 'news',
            data_key: `${source.name}_${item.url}`,
            data_value: { ...item, section: 'rail', language: source.language },
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
