// collectors/news_global.ts
// ê¸€ë¡œë²Œ ë¬¼ë¥˜ ë‰´ìŠ¤ ìˆ˜ì§‘ê¸°
// ëŒ€ìƒ: FreightWaves, AirCargoNews, SupplyChainDive, TTNews, CNBC, The Loadstar, Splash247

import { rateLimited } from './utils/rate_limiter';
import { snapshotWriter } from './utils/snapshot_writer';
import { dbUpsert, dbDeleteBefore } from './utils/supabase_writer';
import type { CollectorResult, NewsItem } from './types';

const SOURCES = [
  { name: 'CNBC Logistics',  rss: 'https://www.cnbc.com/id/100003114/device/rss/rss.html',  section: 'air'      as const, language: 'en' },
  { name: 'AirCargoNews',    rss: 'https://www.aircargonews.net/feed/',                       section: 'air'      as const, language: 'en' },
  { name: 'SupplyChainDive', rss: 'https://www.supplychaindive.com/feeds/news/',              section: 'trade'    as const, language: 'en' },
  { name: 'TTNews',          rss: 'https://www.ttnews.com/rss.xml',                           section: 'trade'    as const, language: 'en' },
  { name: 'FreightWaves',    rss: 'https://www.freightwaves.com/feed',                        section: 'shipping' as const, language: 'en' },
  // ì‹ ê·œ ì¶”ê°€
  { name: 'The Loadstar',    rss: 'https://theloadstar.com/feed/',                            section: 'shipping' as const, language: 'en' },
  { name: 'Splash247',       rss: 'https://splash247.com/feed/',                              section: 'shipping' as const, language: 'en' },
];

async function parseRssFeed(url: string): Promise<NewsItem[]> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Logisight/1.0 (logisight.mtlship.com; news-bot)' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  const text = await res.text();
  const items: NewsItem[] = [];
  const itemMatches = text.matchAll(/<item>([\s\S]*?)<\/item>/g);
  for (const match of itemMatches) {
    const block = match[1];
    const title = block.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/)?.[1]
      || block.match(/<title>(.*?)<\/title>/)?.[1] || '';
    const link  = block.match(/<link>(.*?)<\/link>/)?.[1]
      || block.match(/<guid>(.*?)<\/guid>/)?.[1]   || '';
    const pubDate     = block.match(/<pubDate>(.*?)<\/pubDate>/)?.[1] || '';
    const description = block.match(/<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>/)?.[1]
      || block.match(/<description>([\s\S]*?)<\/description>/)?.[1] || '';
    if (title && link) {
      items.push({
        title:       title.trim(),
        url:         link.trim(),
        published_at: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString(),
        summary_en:  description.replace(/<[^>]*>/g, '').slice(0, 300).trim(),
        source:      '',
      });
    }
    if (items.length >= 5) break;
  }
  return items;
}

// Supabase ì˜êµ¬ ì €ìž¥ + 30ì¼ ì´ì „ ì •ë¦¬
async function persistMaritimeNews(result: CollectorResult): Promise<void> {
  const rows: Record<string, unknown>[] = [];
  for (const d of result.data) {
    if (!d.is_complete) continue;
    const v = d.data_value as NewsItem & { section: string; language: string };
    if (!v.url) continue;
    rows.push({
      title:        (v.title       ?? '').slice(0, 500),
      url:          v.url,
      source:       v.source,
      published_at: v.published_at ?? null,
      summary:      (v.summary_en  ?? '').slice(0, 300),
      lang:         v.language     ?? 'en',
    });
  }
  await dbUpsert('maritime_news', rows, 'url');

  // 30ì¼ ë¡¤ë§ ì •ë¦¬
  const cutoff = new Date(Date.now() - 30 * 86_400_000).toISOString();
  await dbDeleteBefore('maritime_news', 'published_at', cutoff);
}

async function runStandalone() {
  const result = await collect();
  await snapshotWriter(result);
}

if (require.main === module) {
  runStandalone().catch(err => { console.error(err); process.exit(1); });
}

export async function collect(): Promise<CollectorResult> {
  const result: CollectorResult = { section: 'shipping', data: [] };

  for (const source of SOURCES) {
    try {
      const items = await rateLimited(source.rss, () => parseRssFeed(source.rss));
      for (const item of items) {
        result.data.push({
          data_type: 'news',
          data_key:  `${source.name}_${Date.now()}`,
          data_value: { ...item, source: source.name, section: source.section, language: source.language },
          source:     source.name,
          source_url: source.rss,
          is_complete: true,
        });
      }
      console.log(`âœ… ${source.name}: ${items.length}ê±´ ìˆ˜ì§‘`);
    } catch (error) {
      console.error(`âŒ ${source.name} ìˆ˜ì§‘ ì‹¤íŒ¨:`, (error as Error).message);
      result.data.push({
        data_type: 'news', data_key: `${source.name}_error`, data_value: {},
        source: source.name, source_url: source.rss, is_complete: false,
        error_message: (error as Error).message,
      });
    }
  }

  await persistMaritimeNews(result).catch(e =>
    console.warn('[maritime_news] Supabase persist skipped:', (e as Error).message)
  );

  return result;
}
