// workers/collectors/ocean_news.ts
// 해상 전문뉴스 수집기 — RSS 기반 (news_global.ts에 없는 소스)
// 소스: Container News, Hellenic, Seatrade, Maritime Executive, gCaptain (daily)
//       Sea-Intelligence (weekly, HTML)

import { rateLimited } from './utils/rate_limiter';
import { snapshotWriter } from './utils/snapshot_writer';
import type { CollectorResult, NewsItem } from './types';

const BOT_HEADERS = { 'User-Agent': 'Logisight/1.0 (logisight.mtlship.com; news-bot)' };

// 키워드 필터 — 없는 기사 드롭 (노이즈 감소)
const SHIPPING_KEYWORDS = [
  'container', 'blank sailing', 'surcharge', 'congestion', 'port',
  'gri', 'void', 'omission', 'freight rate', 'schedule', 'carrier',
  'shipping', 'disruption', 'vessel', 'terminal', 'throughput',
];

interface OceanNewsSource {
  name: string;
  url: string;
  type: 'rss' | 'html';
  frequency: 'daily' | 'weekly';
  useKeywordFilter: boolean;
}

const OCEAN_NEWS_SOURCES: OceanNewsSource[] = [
  { name: 'Container News',      url: 'https://container-news.com/feed/',                    type: 'rss',  frequency: 'daily',  useKeywordFilter: false },
  { name: 'Hellenic Shipping',   url: 'https://www.hellenicshippingnews.com/feed/',           type: 'rss',  frequency: 'daily',  useKeywordFilter: true  },
  { name: 'Seatrade Maritime',   url: 'https://www.seatrade-maritime.com/feed/',              type: 'rss',  frequency: 'daily',  useKeywordFilter: true  },
  { name: 'Maritime Executive',  url: 'https://maritime-executive.com/feed/',                 type: 'rss',  frequency: 'daily',  useKeywordFilter: true  },
  { name: 'gCaptain',           url: 'https://gcaptain.com/feed/',                           type: 'rss',  frequency: 'daily',  useKeywordFilter: true  },
  { name: 'Sea-Intelligence',    url: 'https://www.sea-intelligence.com/press-room',          type: 'html', frequency: 'weekly', useKeywordFilter: false },
];

function passesKeywordFilter(title: string): boolean {
  const lower = title.toLowerCase();
  return SHIPPING_KEYWORDS.some(kw => lower.includes(kw));
}

async function parseRss(src: OceanNewsSource): Promise<NewsItem[]> {
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
    if (src.useKeywordFilter && !passesKeywordFilter(title)) continue;
    items.push({ title, url: link, published_at: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString(), summary_en: '', source: src.name });
    if (items.length >= 5) break;
  }
  return items;
}

async function fetchHtmlLinks(src: OceanNewsSource): Promise<NewsItem[]> {
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
  const result: CollectorResult = { section: 'shipping', data: [] };
  const sources = OCEAN_NEWS_SOURCES.filter(s => s.frequency === opts.frequency);

  const settled = await Promise.allSettled(
    sources.map(src => rateLimited(src.url, () => src.type === 'rss' ? parseRss(src) : fetchHtmlLinks(src)))
  );

  for (let i = 0; i < sources.length; i++) {
    const src = sources[i];
    const res = settled[i];
    if (res.status === 'rejected') {
      console.log(`⚠️ ${src.name} 실패: ${(res.reason as Error).message}`);
      continue;
    }
    for (const item of res.value) {
      result.data.push({
        data_type: 'news',
        data_key: `OCEAN_NEWS_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        data_value: { ...item, section: 'shipping', language: 'en', category: 'ocean_news' },
        source: src.name, source_url: src.url, is_complete: true,
      });
    }
    console.log(`✅ ${src.name}: ${res.value.length}건`);
  }

  const success = result.data.filter(d => d.is_complete).length;
  console.log(`\n✅ ocean_news [${opts.frequency}]: ${success}건 수집 완료`);
  return result;
}

if (require.main === module) {
  const freq = (process.argv[2] as 'daily' | 'weekly') || 'daily';
  collect({ frequency: freq }).then(r => snapshotWriter(r)).catch(console.error);
}
