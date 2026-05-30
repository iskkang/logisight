// collectors/rail_tsr.ts
// ì‹œë² ë¦¬ì•„ íš¡ë‹¨ì² ë„ (TSR) ë‰´ìŠ¤ ìˆ˜ì§‘ê¸°
// ëŒ€ìƒ: RZD Partner, PortNews, Vgudok, RailFreight Russia

import { rateLimited } from './utils/rate_limiter';
import { snapshotWriter } from './utils/snapshot_writer';
import type { CollectorResult, NewsItem } from './types';

const RSS_SOURCES = [
  {
    name: 'RailFreight Russia',
    rss: 'https://www.railfreight.com/tag/russian-railways/feed/',
    section: 'rail' as const,
  },
  {
    name: 'PortNews EN',
    rss: 'https://en.portnews.ru/rss/',
    section: 'shipping' as const,
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

// RZD Partner â€” ëŸ¬ì‹œì•„ ì² ë„ ì „ë¬¸ ë§¤ì²´
async function fetchRZDPartner(): Promise<NewsItem[]> {
  const url = 'https://www.rzd-partner.com/rss/';
  try {
    return await parseRss(url, 'RZD Partner');
  } catch {
    // RSS ì‹¤íŒ¨ ì‹œ ë¹ˆ ë°°ì—´ (ì‚¬ì´íŠ¸ ì ‘ê·¼ ë¶ˆì•ˆì •)
    return [];
  }
}

// Deliver-2 â€” ì¤‘ì•™ì•„ì‹œì•„ ë¬¼ë¥˜ ë‰´ìŠ¤
async function fetchDeliver2(): Promise<NewsItem[]> {
  const url = 'https://deliver-2.com/feed/';
  try {
    return await parseRss(url, 'Deliver-2');
  } catch {
    return [];
  }
}

export async function collect(): Promise<CollectorResult> {
  const result: CollectorResult = { section: 'rail', data: [] };

  // RSS ê¸°ë°˜ ìˆ˜ì§‘
  for (const src of RSS_SOURCES) {
    try {
      const items = await rateLimited(src.rss, () => parseRss(src.rss, src.name));
      for (const item of items) {
        result.data.push({
          data_type: 'news',
          data_key: `${src.name}_${Date.now()}`,
          data_value: { ...item, section: src.section, language: 'en' },
          source: src.name,
          source_url: src.rss,
          is_complete: true,
        });
      }
      console.log(`âœ… ${src.name}: ${items.length}ê±´`);
    } catch (e) {
      console.error(`âŒ ${src.name}:`, (e as Error).message);
      result.data.push({
        data_type: 'news',
        data_key: `${src.name}_error`,
        data_value: {},
        source: src.name,
        source_url: src.rss,
        is_complete: false,
        error_message: (e as Error).message,
      });
    }
  }

  // RZD Partner
  try {
    const items = await rateLimited('https://www.rzd-partner.com', () => fetchRZDPartner());
    for (const item of items) {
      result.data.push({
        data_type: 'news',
        data_key: `RZD_${Date.now()}`,
        data_value: { ...item, section: 'rail', language: 'en' },
        source: 'RZD Partner',
        source_url: 'https://www.rzd-partner.com',
        is_complete: true,
      });
    }
    if (items.length > 0) console.log(`âœ… RZD Partner: ${items.length}ê±´`);
  } catch (e) {
    console.error('âŒ RZD Partner:', (e as Error).message);
  }

  // Deliver-2
  try {
    const items = await rateLimited('https://deliver-2.com', () => fetchDeliver2());
    for (const item of items) {
      result.data.push({
        data_type: 'news',
        data_key: `DELIVER2_${Date.now()}`,
        data_value: { ...item, section: 'rail', language: 'en' },
        source: 'Deliver-2',
        source_url: 'https://deliver-2.com',
        is_complete: true,
      });
    }
    if (items.length > 0) console.log(`âœ… Deliver-2: ${items.length}ê±´`);
  } catch (e) {
    console.error('âŒ Deliver-2:', (e as Error).message);
  }

  return result;
}

if (require.main === module) {
  collect().then(r => snapshotWriter(r)).catch(console.error);
}
