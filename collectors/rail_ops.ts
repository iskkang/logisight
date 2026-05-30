// collectors/rail_ops.ts
// 러시아/CIS 운영사 뉴스 수집기 (fetch/RSS 기반, Playwright 미사용)
// 소스: RZD, RZD Logistics, FESCO, TransContainer, Delo, PortNews, SeaNews, KTZ, UTLC, Index1520

import { rateLimited } from './utils/rate_limiter';
import { snapshotWriter } from './utils/snapshot_writer';
import type { CollectorResult, NewsItem } from './types';

const BOT_HEADERS = {
  'User-Agent': 'Logisight/1.0 (logisight.mtlship.com; bot)',
  'Accept-Language': 'en-US,en;q=0.9',
};

interface OpsSource {
  name: string;
  url: string;
  type: 'rss' | 'html';
  frequency: 'daily' | 'weekly';
}

const OPS_SOURCES: OpsSource[] = [
  { name: 'PortNews EN',        url: 'https://en.portnews.ru/rss/',              type: 'rss',  frequency: 'daily'  },
  { name: 'FESCO News',         url: 'https://www.fesco.com/en/press-center/news/', type: 'html', frequency: 'daily'  },
  { name: 'RZD Official EN',    url: 'https://eng.rzd.ru/en/9631?rubricator_id=881', type: 'html', frequency: 'weekly' },
  { name: 'RZD Logistics',      url: 'https://rzdlog.com/press-center/news/',    type: 'html', frequency: 'weekly' },
  { name: 'TransContainer',     url: 'https://trcont.com/en/',                   type: 'html', frequency: 'weekly' },
  { name: 'Delo Group',         url: 'https://www.delo-group.com/',              type: 'html', frequency: 'weekly' },
  { name: 'SeaNews Freight',    url: 'https://www.freight.ru/en/',               type: 'html', frequency: 'weekly' },
  { name: 'KTZ Express',        url: 'https://www.ktze.kz/en',                  type: 'html', frequency: 'weekly' },
  { name: 'UTLC ERA',           url: 'https://www.utlc.com/en/',                type: 'html', frequency: 'weekly' },
  { name: 'Index1520',          url: 'https://index1520.com/en/',               type: 'html', frequency: 'weekly' },
];

async function parseRss(src: OpsSource): Promise<NewsItem[]> {
  const res = await fetch(src.url, { headers: BOT_HEADERS, signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  const items: NewsItem[] = [];
  for (const m of text.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const b = m[1];
    const title   = (b.match(/<title><!\[CDATA\[(.*?)\]\]>/)?.[1] || b.match(/<title>(.*?)<\/title>/)?.[1] || '').trim();
    const link    = (b.match(/<link>(.*?)<\/link>/)?.[1] || '').trim();
    const pubDate = b.match(/<pubDate>(.*?)<\/pubDate>/)?.[1] || '';
    if (!title || !link) continue;
    items.push({ title, url: link, published_at: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString(), summary_en: '', source: src.name });
    if (items.length >= 5) break;
  }
  return items;
}

async function fetchHtmlLinks(src: OpsSource): Promise<NewsItem[]> {
  const res = await fetch(src.url, { headers: BOT_HEADERS, signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  const base = new URL(src.url).origin;
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
    items.push({ title, url: href, published_at: new Date().toISOString(), summary_en: '', source: src.name });
    if (items.length >= 5) break;
  }
  return items;
}

export async function collect(opts: { frequency: 'daily' | 'weekly' } = { frequency: 'daily' }): Promise<CollectorResult> {
  const result: CollectorResult = { section: 'rail', data: [] };
  const sources = OPS_SOURCES.filter(s => s.frequency === opts.frequency);

  const settled = await Promise.allSettled(
    sources.map(src => rateLimited(src.url, () => src.type === 'rss' ? parseRss(src) : fetchHtmlLinks(src)))
  );

  for (let i = 0; i < sources.length; i++) {
    const src = sources[i];
    const res = settled[i];
    if (res.status === 'rejected') {
      console.log(`⚠️ ${src.name} 실패: ${(res.reason as Error).message}`);
      result.data.push({ data_type: 'news', data_key: `${src.name}_error`, data_value: {}, source: src.name, source_url: src.url, is_complete: false, error_message: (res.reason as Error).message });
      continue;
    }
    for (const item of res.value) {
      result.data.push({
        data_type: 'news',
        data_key: `RAIL_OPS_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        data_value: { ...item, section: 'rail', language: 'en', category: 'rail_operator' },
        source: src.name, source_url: src.url, is_complete: true,
      });
    }
    console.log(`✅ ${src.name}: ${res.value.length}건`);
  }

  const success = result.data.filter(d => d.is_complete).length;
  console.log(`\n✅ rail_ops [${opts.frequency}]: ${success}건 수집 완료`);
  return result;
}

if (require.main === module) {
  const freq = (process.argv[2] as 'daily' | 'weekly') || 'daily';
  collect({ frequency: freq }).then(r => snapshotWriter(r)).catch(console.error);
}
