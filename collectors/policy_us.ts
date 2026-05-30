// collectors/policy_us.ts
// 미국 무역정책 수집기
// 대상: USTR, CBP, Federal Register (관세·무역 관련)

import { rateLimited } from './utils/rate_limiter';
import { snapshotWriter } from './utils/snapshot_writer';
import type { CollectorResult, NewsItem } from './types';

const RSS_SOURCES = [
  {
    name: 'USTR',
    rss: 'https://ustr.gov/rss.xml',
    url: 'https://ustr.gov',
    section: 'trade' as const,
  },
  {
    name: 'CBP Trade',
    rss: 'https://www.cbp.gov/rss-feeds/trade-news.xml',
    url: 'https://www.cbp.gov',
    section: 'trade' as const,
  },
];

async function parseRss(url: string, sourceName: string): Promise<NewsItem[]> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Logisight/1.0 (logisight.mtlship.com; bot)' },
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
    ).trim();
    const link = (b.match(/<link>(.*?)<\/link>/)?.[1] || '').trim();
    const pubDate = b.match(/<pubDate>(.*?)<\/pubDate>/)?.[1] || '';

    // 관세·무역 관련 키워드 필터
    const tradeKeywords = /tariff|customs|trade|import|export|section 301|section 232|ieepa|duty|freight/i;
    if (title && link && tradeKeywords.test(title)) {
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

export async function collect(): Promise<CollectorResult> {
  const result: CollectorResult = { section: 'trade', data: [] };

  for (const src of RSS_SOURCES) {
    try {
      const items = await rateLimited(src.rss, () => parseRss(src.rss, src.name));
      for (const item of items) {
        result.data.push({
          data_type: 'policy_news',
          data_key: `${src.name}_${Date.now()}`,
          data_value: { ...item, section: src.section, language: 'en', region: 'US' },
          source: src.name,
          source_url: src.url,
          is_complete: true,
        });
      }
      console.log(`✅ ${src.name}: ${items.length}건`);
    } catch (e) {
      console.error(`❌ ${src.name}:`, (e as Error).message);
      result.data.push({
        data_type: 'policy_news',
        data_key: `${src.name}_error`,
        data_value: {},
        source: src.name,
        source_url: src.url,
        is_complete: false,
        error_message: (e as Error).message,
      });
    }
  }

  return result;
}

if (require.main === module) {
  collect().then(r => snapshotWriter(r)).catch(console.error);
}
