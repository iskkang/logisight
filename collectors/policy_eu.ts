// collectors/policy_eu.ts
// EU 무역·환경 정책 수집기
// 대상: EU CBAM, ETS, 유럽의회 보도자료

import { rateLimited } from './utils/rate_limiter';
import { snapshotWriter } from './utils/snapshot_writer';
import type { CollectorResult, NewsItem } from './types';

const RSS_SOURCES = [
  {
    name: 'EU Commission Trade',
    rss: 'https://ec.europa.eu/commission/presscorner/api/rss?keyword=trade&language=en',
    url: 'https://ec.europa.eu',
    section: 'trade' as const,
  },
  {
    name: 'EU Taxation Customs',
    rss: 'https://taxation-customs.ec.europa.eu/rss.xml',
    url: 'https://taxation-customs.ec.europa.eu',
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

    const euKeywords = /cbam|ets|carbon|emission|shipping|maritime|customs|trade|tariff|supply chain/i;
    if (title && link && euKeywords.test(title)) {
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

// EU CBAM 공식 페이지 RSS fallback
async function fetchEUCBAMNews(): Promise<NewsItem[]> {
  const url = 'https://taxation-customs.ec.europa.eu/carbon-border-adjustment-mechanism_en';
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Logisight/1.0 (logisight.mtlship.com; bot)' },
    });
    const html = await res.text();
    const items: NewsItem[] = [];

    // 뉴스 링크 추출
    const linkMatches = html.matchAll(/<a[^>]+href="([^"]+cbam[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi);
    for (const m of linkMatches) {
      const url = m[1].startsWith('http') ? m[1] : `https://taxation-customs.ec.europa.eu${m[1]}`;
      const title = m[2].replace(/<[^>]*>/g, '').trim();
      if (title.length > 10 && title.length < 150) {
        items.push({
          title,
          url,
          published_at: new Date().toISOString(),
          summary_en: '',
          source: 'EU CBAM',
        });
      }
      if (items.length >= 3) break;
    }
    return items;
  } catch {
    return [];
  }
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
          data_value: { ...item, section: src.section, language: 'en', region: 'EU' },
          source: src.name,
          source_url: src.url,
          is_complete: true,
        });
      }
      console.log(`✅ ${src.name}: ${items.length}건`);
    } catch (e) {
      console.error(`❌ ${src.name}:`, (e as Error).message);

      // RSS 실패 시 CBAM 직접 페이지 시도
      try {
        const cbamItems = await rateLimited('https://taxation-customs.ec.europa.eu', () => fetchEUCBAMNews());
        for (const item of cbamItems) {
          result.data.push({
            data_type: 'policy_news',
            data_key: `EU_CBAM_${Date.now()}`,
            data_value: { ...item, section: 'trade', language: 'en', region: 'EU' },
            source: 'EU CBAM',
            source_url: 'https://taxation-customs.ec.europa.eu',
            is_complete: true,
          });
        }
        if (cbamItems.length > 0) console.log(`✅ EU CBAM fallback: ${cbamItems.length}건`);
      } catch {}
    }
  }

  return result;
}

if (require.main === module) {
  collect().then(r => snapshotWriter(r)).catch(console.error);
}
