// workers/collectors/news_global.ts
// 글로벌 물류 뉴스 수집기
// 대상: FreightWaves, AirCargoNews, SupplyChainDive, TTNews, CNBC

import { rateLimited } from './utils/rate_limiter';
import { snapshotWriter } from './utils/snapshot_writer';
import type { CollectorResult, NewsItem } from './types';

const SOURCES = [
  {
    name: 'CNBC Logistics',
    rss: 'https://www.cnbc.com/id/100003114/device/rss/rss.html',
    section: 'air' as const,
    language: 'en',
  },
  {
    name: 'AirCargoNews',
    rss: 'https://www.aircargonews.net/feed/',
    section: 'air' as const,
    language: 'en',
  },
  {
    name: 'SupplyChainDive',
    rss: 'https://www.supplychaindive.com/feeds/news/',
    section: 'trade' as const,
    language: 'en',
  },
  {
    name: 'TTNews',
    rss: 'https://www.ttnews.com/rss.xml',
    section: 'trade' as const,
    language: 'en',
  },
  {
    name: 'FreightWaves',
    rss: 'https://www.freightwaves.com/feed',
    section: 'shipping' as const,
    language: 'en',
  },
];

async function parseRssFeed(url: string): Promise<NewsItem[]> {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Logisight/1.0 (logisight.mtlship.com; news-bot)',
    },
  });

  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);

  const text = await res.text();
  const items: NewsItem[] = [];

  // XML 파싱 (간단한 정규식 — 구조 변경 시 robust XML parser 도입)
  const itemMatches = text.matchAll(/<item>([\s\S]*?)<\/item>/g);

  for (const match of itemMatches) {
    const block = match[1];

    const title = block.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>|<title>(.*?)<\/title>/)?.[1]
      || block.match(/<title>(.*?)<\/title>/)?.[1]
      || '';

    const link = block.match(/<link>(.*?)<\/link>/)?.[1]
      || block.match(/<guid>(.*?)<\/guid>/)?.[1]
      || '';

    const pubDate = block.match(/<pubDate>(.*?)<\/pubDate>/)?.[1] || '';

    const description = block.match(/<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>/)?.[1]
      || block.match(/<description>([\s\S]*?)<\/description>/)?.[1]
      || '';

    if (title && link) {
      items.push({
        title: title.trim(),
        url: link.trim(),
        published_at: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString(),
        summary_en: description.replace(/<[^>]*>/g, '').slice(0, 300).trim(),
        source: '',
      });
    }

    if (items.length >= 5) break; // 사이트당 최신 5건만
  }

  return items;
}

async function runStandalone() {
  const result = await collect();
  await snapshotWriter(result);
}

if (require.main === module) {
  runStandalone().catch(err => { console.error(err); process.exit(1); });
}

export async function collect(): Promise<CollectorResult> {
  const result: CollectorResult = {
    section: 'shipping',
    data: [],
  };

  for (const source of SOURCES) {
    try {
      const items = await rateLimited(source.rss, () => parseRssFeed(source.rss));

      for (const item of items) {
        result.data.push({
          data_type: 'news',
          data_key: `${source.name}_${Date.now()}`,
          data_value: {
            ...item,
            source: source.name,
            section: source.section,
            language: source.language,
          },
          source: source.name,
          source_url: source.rss,
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
        source_url: source.rss,
        is_complete: false,
        error_message: (error as Error).message,
      });
    }
  }

  return result;
}
