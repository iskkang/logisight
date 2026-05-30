// workers/collectors/news_korea.ts
// 한국 물류 뉴스 수집기 — RSS + fetch 기반 (Playwright 미사용)
// 대상: 카고뉴스, 쉬핑뉴스넷, 쉬핑데일리, 카고프레스, KL뉴스, 마리타임프레스

import { rateLimited } from './utils/rate_limiter';
import { snapshotWriter } from './utils/snapshot_writer';
import type { CollectorResult, NewsItem } from './types';

const SOURCES = [
  {
    name: '카고뉴스',
    url: 'https://www.cargonews.co.kr/',
    rss: ['https://www.cargonews.co.kr/rss/allArticle.xml'],
    section: 'shipping' as const,
  },
  {
    name: '쉬핑뉴스넷',
    url: 'https://www.shippingnewsnet.com/',
    rss: [
      'https://www.shippingnewsnet.com/feed',
      'https://www.shippingnewsnet.com/feed/rss',
      'https://www.shippingnewsnet.com/rss.xml',
    ],
    section: 'shipping' as const,
  },
  {
    name: '쉬핑데일리',
    url: 'https://www.shippingdaily.co.kr/index.php',
    rss: [
      'https://www.shippingdaily.co.kr/feed',
      'https://www.shippingdaily.co.kr/rss.xml',
      'https://www.shippingdaily.co.kr/feed/rss',
    ],
    section: 'shipping' as const,
  },
  {
    name: '카고프레스',
    url: 'https://www.cargopress.co.kr/korean/news.php',
    rss: null,
    section: 'shipping' as const,
  },
  {
    name: 'KL뉴스',
    url: 'https://www.klnews.co.kr/',
    rss: null,
    section: 'shipping' as const,
  },
  {
    name: '마리타임프레스',
    url: 'http://www.maritimepress.co.kr/',
    rss: null,
    section: 'shipping' as const,
  },
];

const FETCH_HEADERS = {
  'User-Agent': 'Logisight/1.0 (logisight.mtlship.com; news-bot)',
  'Accept-Language': 'ko-KR,ko;q=0.9',
};

async function parseRss(rssUrl: string, sourceName: string): Promise<NewsItem[]> {
  const res = await fetch(rssUrl, {
    headers: FETCH_HEADERS,
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

    if (title && link) {
      items.push({
        title,
        url: link,
        published_at: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString(),
        summary_en: '',
        source: sourceName,
      });
    }
    if (items.length >= 5) break;
  }
  return items;
}

async function tryRssFallbacks(urls: string[], sourceName: string): Promise<NewsItem[]> {
  for (const url of urls) {
    try {
      const items = await parseRss(url, sourceName);
      if (items.length > 0) return items;
    } catch {
      // try next
    }
  }
  throw new Error(`RSS 모든 후보 실패: ${urls.join(', ')}`);
}

async function fetchAndParseHtml(pageUrl: string, sourceName: string): Promise<NewsItem[]> {
  const res = await fetch(pageUrl, {
    headers: FETCH_HEADERS,
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();

  const base = new URL(pageUrl).origin;
  const items: NewsItem[] = [];
  const seen = new Set<string>();

  for (const m of html.matchAll(/<a[^>]+href="([^"]+)"[^>]*>([^<]{8,120})<\/a>/g)) {
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

    if (items.length >= 5) break;
  }
  return items;
}

export async function collect(): Promise<CollectorResult> {
  const result: CollectorResult = { section: 'shipping', data: [] };

  for (const source of SOURCES) {
    try {
      const items = source.rss
        ? await rateLimited(source.url, () => tryRssFallbacks(source.rss!, source.name))
        : await rateLimited(source.url, () => fetchAndParseHtml(source.url, source.name));

      for (const item of items) {
        result.data.push({
          data_type: 'news',
          data_key: `${source.name}_${Date.now()}`,
          data_value: { ...item, source: source.name, section: source.section, language: 'ko' },
          source: source.name,
          source_url: source.url,
          is_complete: true,
        });
      }
      console.log(`✅ ${source.name}: ${items.length}건 수집`);
    } catch (error) {
      console.error(`❌ ${source.name} 수집 실패:`, (error as Error).message);
      result.data.push({
        data_type: 'news',
        data_key: `${source.name}_error`,
        data_value: {},
        source: source.name,
        source_url: source.url,
        is_complete: false,
        error_message: (error as Error).message,
      });
    }
  }

  return result;
}

if (require.main === module) {
  collect().then(r => {
    const success = r.data.filter(d => d.is_complete).length;
    console.log(`\n총 ${r.data.length}건 중 ${success}건 수집 완료`);
    return snapshotWriter(r);
  }).catch(console.error);
}
