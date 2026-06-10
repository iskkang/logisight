// collectors/news_logistics.ts
// 글로벌 물류 대기업 뉴스 수집기 (RSS 기반)
// 대상: DHL, FedEx, UPS, DSV, Kuehne+Nagel, DB Schenker, Flexport + 업계 미디어
// 출력 section: 'logistics'

import { rateLimited } from './utils/rate_limiter';
import { snapshotWriter } from './utils/snapshot_writer';
import type { CollectorResult, NewsItem } from './types';

const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

const SOURCES = [
  // ── 업계 미디어 (RSS 안정적) ──────────────────────────────────────────
  {
    name: 'Logistics Management',
    rss: 'https://www.logisticsmgmt.com/rss/section/news',
    section: 'logistics' as const,
  },
  {
    name: 'DC Velocity',
    rss: 'https://www.dcvelocity.com/rss/news',
    section: 'logistics' as const,
  },
  {
    name: 'Supply Chain Brain',
    rss: 'https://www.supplychainbrain.com/rss/news',
    section: 'logistics' as const,
  },
  {
    name: 'Inbound Logistics',
    rss: 'https://www.inboundlogistics.com/feed/',
    section: 'logistics' as const,
  },
];

// 물류 관련성 키워드 필터 (업계 미디어는 광범위하므로 필터 적용)
const LOGISTICS_KEYWORDS = /freight|logistics|forwarder|supply chain|warehouse|dhl|fedex|ups|dsv|kuehne|schenker|flexport|ceva|bolloré|panalpina|shipment|parcel|last.?mile|fulfillment|3pl|4pl/i;

async function parseRssFeed(url: string): Promise<NewsItem[]> {
  const res = await fetch(url, {
    headers: {
      'User-Agent': BROWSER_UA,
      'Accept': 'application/rss+xml, application/xml, text/xml, */*;q=0.8',
    },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  const items: NewsItem[] = [];
  const matches = text.matchAll(/<item>([\s\S]*?)<\/item>/g);

  for (const m of matches) {
    const b = m[1];
    const title = (
      b.match(/<title><!\[CDATA\[(.*?)\]\]>/)?.[1] ||
      b.match(/<title>(.*?)<\/title>/)?.[1] || ''
    ).replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
    const link = (
      b.match(/<link>(.*?)<\/link>/)?.[1] ||
      b.match(/<guid isPermaLink="true">(.*?)<\/guid>/)?.[1] || ''
    ).trim();
    const pubDate = b.match(/<pubDate>(.*?)<\/pubDate>/)?.[1] || '';
    const desc = (
      b.match(/<description><!\[CDATA\[([\s\S]*?)\]\]>/)?.[1] ||
      b.match(/<description>([\s\S]*?)<\/description>/)?.[1] || ''
    ).replace(/<[^>]*>/g, '').slice(0, 300).trim();

    if (title && link) items.push({
      title,
      url: link,
      published_at: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString(),
      summary_en: desc,
      source: '',
    });
    if (items.length >= 8) break;
  }
  return items;
}

export async function collect(): Promise<CollectorResult> {
  const result: CollectorResult = { section: 'logistics', data: [] };

  for (const source of SOURCES) {
    try {
      const items = await rateLimited(source.rss, () => parseRssFeed(source.rss));
      let added = 0;
      for (const item of items) {
        if (!LOGISTICS_KEYWORDS.test(item.title + ' ' + item.summary_en)) continue;

        result.data.push({
          data_type: 'news',
          data_key: `${source.name}_${encodeURIComponent(item.url)}`,
          data_value: { ...item, source: source.name, section: source.section, language: 'en' },
          source: source.name,
          source_url: source.rss,
          is_complete: true,
        });
        added++;
      }
      console.log(`✅ ${source.name}: ${added}건`);
    } catch (error) {
      console.warn(`⚠️ ${source.name}: ${(error as Error).message}`);
      result.data.push({
        data_type: 'news', data_key: `${source.name}_error`, data_value: {},
        source: source.name, source_url: source.rss,
        is_complete: false, error_message: (error as Error).message,
      });
    }
  }

  return result;
}

if (require.main === module) {
  collect().then(r => snapshotWriter(r)).catch(console.error);
}
