// workers/collectors/rail_tcr.ts
// 중국-유럽 철도 (TCR/BRI) 수집기 — fetch+RSS 기반, Playwright는 TransportCorridors만
// 대상: RailFreight BRI RSS, Silk Road Briefing, Kazakhstan Today,
//       China Daily RSS, Global Times RSS, TransportCorridors (Playwright)

import { chromium, type Browser } from 'playwright';
import { rateLimited } from './utils/rate_limiter';
import { snapshotWriter } from './utils/snapshot_writer';
import type { CollectorResult, NewsItem } from './types';

const BOT_HEADERS = {
  'User-Agent': 'Logisight/1.0 (logisight.mtlship.com; bot)',
  'Accept-Language': 'en-US,en;q=0.9',
};

// ── 공통: RSS 파싱 ───────────────────────────────────────────────
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

// ── 공통: fetch HTML 링크 파싱 ──────────────────────────────────
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

// ── TransportCorridors (Playwright 유지) ───────────────────────
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
    console.log(`⚠️ TransportCorridors 실패: ${(e as Error).message}`);
    return [];
  } finally {
    await page.close();
  }
}

export async function collect(): Promise<CollectorResult> {
  const result: CollectorResult = { section: 'rail', data: [] };

  // ── 1. fetch/RSS 소스 병렬 수집 ────────────────────────────────
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
      console.log(`⚠️ ${src.label} 실패: ${(res.reason as Error).message}`);
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
    console.log(`✅ ${src.label}: ${res.value.length}건`);
  }

  // ── 2. TransportCorridors (Playwright) ────────────────────────
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
    console.log(`✅ TransportCorridors: ${items.length}건`);
  } catch (e) {
    console.error('❌ TransportCorridors:', (e as Error).message);
  } finally {
    if (browser) await browser.close();
  }

  const success = result.data.filter(d => d.is_complete).length;
  console.log(`\n✅ rail_tcr: 총 ${result.data.length}건 중 ${success}건 수집 완료`);

  return result;
}

if (require.main === module) {
  collect().then(r => snapshotWriter(r)).catch(console.error);
}
