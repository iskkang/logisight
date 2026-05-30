// collectors/chokepoints.ts
// í•­ë¡œ ë¦¬ìŠ¤í¬ ìˆ˜ì§‘ê¸° â€” UKMTO(daily), Panama/Suez/BIMCO(weekly)

import { rateLimited } from './utils/rate_limiter';
import { snapshotWriter } from './utils/snapshot_writer';
import type { CollectorResult, NewsItem } from './types';

const BOT_HEADERS = {
  'User-Agent': 'Logisight/1.0 (logisight.mtlship.com; bot)',
  'Accept-Language': 'en-US,en;q=0.9',
};

function detectRegion(text: string): string {
  const t = text.toLowerCase();
  if (t.includes('red sea') || t.includes('bab-el-mandeb') || t.includes('houthi')) return 'Red Sea';
  if (t.includes('gulf of aden'))    return 'Gulf of Aden';
  if (t.includes('indian ocean'))    return 'Indian Ocean';
  if (t.includes('gulf of oman') || t.includes('hormuz')) return 'Gulf of Oman';
  if (t.includes('arabian sea'))     return 'Arabian Sea';
  return 'Other';
}

async function fetchUKMTO(): Promise<NewsItem[]> {
  const url = 'https://www.ukmto.org/recent-incidents';
  const res = await fetch(url, { headers: BOT_HEADERS, signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  const items: NewsItem[] = [];
  const seen = new Set<string>();
  for (const m of html.matchAll(/<a[^>]+href="([^"]+)"[^>]*>([^<]{10,150})<\/a>/g)) {
    let href = m[1].trim();
    const title = m[2].trim().replace(/\s+/g, ' ');
    if (!href || href.startsWith('javascript') || href.startsWith('#')) continue;
    if (seen.has(title)) continue;
    if (href.startsWith('/')) href = `https://www.ukmto.org${href}`;
    if (!href.startsWith('http')) continue;
    const region = detectRegion(title);
    seen.add(title);
    items.push({ title: `[${region}] ${title}`, url: href, published_at: new Date().toISOString(), summary_en: '', source: 'UKMTO' });
    if (items.length >= 5) break;
  }
  return items;
}

async function fetchHtmlLinks(url: string, sourceName: string): Promise<NewsItem[]> {
  const res = await fetch(url, { headers: BOT_HEADERS, signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  const base = new URL(url).origin;
  const items: NewsItem[] = [];
  const seen = new Set<string>();
  for (const m of html.matchAll(/<a[^>]+href="([^"]+)"[^>]*>([^<]{10,120})<\/a>/g)) {
    let href = m[1].trim();
    const title = m[2].trim().replace(/\s+/g, ' ');
    if (!href || href.startsWith('javascript') || href.startsWith('#')) continue;
    if (seen.has(title)) continue;
    if (href.startsWith('/')) href = `${base}${href}`;
    if (!href.startsWith('http')) continue;
    seen.add(title);
    items.push({ title, url: href, published_at: new Date().toISOString(), summary_en: '', source: sourceName });
    if (items.length >= 5) break;
  }
  return items;
}

export async function collect(opts: { frequency: 'daily' | 'weekly' } = { frequency: 'daily' }): Promise<CollectorResult> {
  const result: CollectorResult = { section: 'risk', data: [] };

  // UKMTO â€” daily
  try {
    const items = await rateLimited('https://www.ukmto.org', () => fetchUKMTO());
    for (const item of items) {
      result.data.push({
        data_type: 'news',
        data_key: `UKMTO_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        data_value: { ...item, section: 'risk', language: 'en', category: 'maritime_security' },
        source: 'UKMTO', source_url: 'https://www.ukmto.org/recent-incidents', is_complete: true,
      });
    }
    console.log(`âœ… UKMTO: ${items.length}ê±´`);
  } catch (e) {
    console.log(`âš ï¸ UKMTO ì‹¤íŒ¨: ${(e as Error).message}`);
  }

  if (opts.frequency === 'weekly') {
    const weeklySources = [
      { name: 'Panama Canal', url: 'https://pancanal.com/en/maritime-services/advisory-to-shipping/' },
      { name: 'BIMCO',        url: 'https://www.bimco.org/news' },
    ];
    for (const src of weeklySources) {
      try {
        const items = await rateLimited(src.url, () => fetchHtmlLinks(src.url, src.name));
        for (const item of items) {
          result.data.push({
            data_type: 'news',
            data_key: `CHOKE_${src.name}_${Date.now()}`,
            data_value: { ...item, section: 'risk', language: 'en', category: 'chokepoint' },
            source: src.name, source_url: src.url, is_complete: true,
          });
        }
        console.log(`âœ… ${src.name}: ${items.length}ê±´`);
      } catch (e) {
        console.log(`âš ï¸ ${src.name} ì‹¤íŒ¨: ${(e as Error).message}`);
      }
    }
  }

  const success = result.data.filter(d => d.is_complete).length;
  console.log(`\nâœ… chokepoints [${opts.frequency}]: ${success}ê±´ ìˆ˜ì§‘ ì™„ë£Œ`);
  return result;
}

if (require.main === module) {
  const freq = (process.argv[2] as 'daily' | 'weekly') || 'daily';
  collect({ frequency: freq }).then(r => snapshotWriter(r)).catch(console.error);
}
