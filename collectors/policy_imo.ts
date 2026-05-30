// collectors/policy_imo.ts
// IMO 해사 정책 수집기
// 대상: IMO 공식 뉴스, MEPC 결정사항

import { rateLimited } from './utils/rate_limiter';
import { snapshotWriter } from './utils/snapshot_writer';
import type { CollectorResult, NewsItem } from './types';

const IMO_SOURCES = [
  {
    name: 'IMO News',
    rss: 'https://www.imo.org/en/MediaCentre/Pages/WhatsNew-RSS.aspx',
    url: 'https://www.imo.org',
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

  // RSS 또는 Atom 형식 모두 처리
  const itemMatches = text.matchAll(/<item>([\s\S]*?)<\/item>|<entry>([\s\S]*?)<\/entry>/g);

  for (const m of itemMatches) {
    const b = m[1] || m[2];
    const title = (
      b.match(/<title><!\[CDATA\[(.*?)\]\]>/)?.[1] ||
      b.match(/<title[^>]*>(.*?)<\/title>/)?.[1] || ''
    ).replace(/<[^>]*>/g, '').trim();

    const link = b.match(/<link[^>]*href="([^"]+)"/)?.[1]
      || b.match(/<link>(.*?)<\/link>/)?.[1]
      || '';

    const pubDate = b.match(/<pubDate>(.*?)<\/pubDate>/)?.[1]
      || b.match(/<updated>(.*?)<\/updated>/)?.[1] || '';

    const imoKeywords = /mepc|environment|emission|carbon|decarboni|shipping|regulation|marpol|imo/i;
    if (title && link && imoKeywords.test(title)) {
      items.push({
        title,
        url: link.startsWith('http') ? link : `https://www.imo.org${link}`,
        published_at: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString(),
        summary_en: '',
        source: sourceName,
      });
    }
    if (items.length >= 5) break;
  }
  return items;
}

// IMO 뉴스 페이지 fallback (RSS 실패 시)
async function fetchIMONewsPage(): Promise<NewsItem[]> {
  const url = 'https://www.imo.org/en/MediaCentre/Pages/WhatsNew.aspx';
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Logisight/1.0 (logisight.mtlship.com; bot)' },
    });
    const html = await res.text();
    const items: NewsItem[] = [];

    const linkMatches = html.matchAll(/<a[^>]+href="(\/en\/[^"]+)"[^>]*>\s*<h\d[^>]*>([\s\S]*?)<\/h\d>/gi);
    for (const m of linkMatches) {
      const title = m[2].replace(/<[^>]*>/g, '').trim();
      if (title.length > 10 && title.length < 150) {
        items.push({
          title,
          url: `https://www.imo.org${m[1]}`,
          published_at: new Date().toISOString(),
          summary_en: '',
          source: 'IMO',
        });
      }
      if (items.length >= 5) break;
    }
    return items;
  } catch {
    return [];
  }
}

export async function collect(): Promise<CollectorResult> {
  const result: CollectorResult = { section: 'trade', data: [] };

  for (const src of IMO_SOURCES) {
    try {
      const items = await rateLimited(src.rss, () => parseRss(src.rss, src.name));

      if (items.length === 0) {
        // fallback
        const pageItems = await rateLimited(src.url, () => fetchIMONewsPage());
        for (const item of pageItems) {
          result.data.push({
            data_type: 'policy_news',
            data_key: `IMO_${Date.now()}`,
            data_value: { ...item, section: src.section, language: 'en', region: 'IMO' },
            source: 'IMO',
            source_url: src.url,
            is_complete: true,
          });
        }
        console.log(`✅ IMO (fallback): ${pageItems.length}건`);
      } else {
        for (const item of items) {
          result.data.push({
            data_type: 'policy_news',
            data_key: `${src.name}_${Date.now()}`,
            data_value: { ...item, section: src.section, language: 'en', region: 'IMO' },
            source: src.name,
            source_url: src.url,
            is_complete: true,
          });
        }
        console.log(`✅ ${src.name}: ${items.length}건`);
      }

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
