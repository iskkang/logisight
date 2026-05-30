// collectors/bunker.ts
// ë²™ì»¤ìœ  ê°€ê²© ìˆ˜ì§‘ê¸° â€” Ship & Bunker í•­êµ¬ë³„ íŽ˜ì´ì§€ fetch + regex íŒŒì‹±
// ëŒ€ìƒ: Singapore Â· Rotterdam Â· Fujairah (VLSFO Â· IFO380 Â· MGO)

import { rateLimited } from './utils/rate_limiter';
import { snapshotWriter } from './utils/snapshot_writer';
import { dbUpsert } from './utils/supabase_writer';
import type { CollectorResult } from './types';

const PORTS = [
  { port: 'Singapore', url: 'https://shipandbunker.com/prices/apac/sg/sg-sin-singapore' },
  { port: 'Rotterdam',  url: 'https://shipandbunker.com/prices/emea/nwe/nl-rtm-rotterdam' },
  { port: 'Fujairah',   url: 'https://shipandbunker.com/prices/me/uae/ae-fuj-fujairah' },
] as const;

// Fuel grade patterns: capture first 3-4 digit number after the grade label.
// Prices are typically 200-1500 USD/MT â€” sanity-checked below.
const FUEL_PATTERNS = [
  { grade: 'VLSFO',  re: /VLSFO[\s\S]{0,300}?(\d{3,4}(?:\.\d{1,2})?)/i },
  { grade: 'IFO380', re: /IFO[\s-]?380[\s\S]{0,300}?(\d{3,4}(?:\.\d{1,2})?)/i },
  { grade: 'MGO',    re: /\bMGO\b[\s\S]{0,300}?(\d{3,4}(?:\.\d{1,2})?)/i },
] as const;

interface BunkerRow {
  grade: string;
  port:  string;
  priceUsd: number | null;
  url:   string;
}

async function fetchPortPrices(port: string, url: string): Promise<BunkerRow[]> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Logisight/1.0 (logisight.mtlship.com; bot)', Accept: 'text/html' },
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();

  return FUEL_PATTERNS.map(({ grade, re }) => {
    const m = html.match(re);
    const raw = m ? parseFloat(m[1]) : null;
    // Sanity check: bunker prices are 200â€“1500 USD/MT
    const valid = raw != null && raw >= 200 && raw <= 1500;
    return { grade, port, priceUsd: valid ? raw : null, url };
  });
}

async function persistBunkerPrices(rows: BunkerRow[]): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  const dbRows = rows
    .filter(r => r.priceUsd != null)
    .map(r => ({
      grade:      r.grade,
      port:       r.port,
      price_usd:  r.priceUsd,
      obs_date:   today,
      source:     'Ship & Bunker',
      source_url: r.url,
    }));
  await dbUpsert('bunker_prices', dbRows, 'grade,port,obs_date');
}

export async function collect(): Promise<CollectorResult> {
  const result: CollectorResult = { section: 'shipping', data: [] };
  const allRows: BunkerRow[] = [];

  for (const { port, url } of PORTS) {
    try {
      const rows = await rateLimited(url, () => fetchPortPrices(port, url));
      allRows.push(...rows);
      for (const r of rows) {
        result.data.push({
          data_type:  'bunker',
          data_key:   `BUNKER_${r.grade}_${r.port.toUpperCase()}`,
          data_value: { ...r, date: new Date().toISOString().slice(0, 10),
                        source: 'Ship & Bunker', source_url: r.url },
          source:     'Ship & Bunker',
          source_url: r.url,
          is_complete: r.priceUsd !== null,
          error_message: r.priceUsd === null ? 'ê°€ê²© íŒŒì‹± ì‹¤íŒ¨' : undefined,
        });
      }
      const ok = rows.filter(r => r.priceUsd !== null).length;
      console.log(`âœ… bunker [${port}]: ${ok}/${rows.length}ê°œ ìˆ˜ì§‘`);
    } catch (e) {
      console.warn(`âš ï¸ bunker [${port}] ì‹¤íŒ¨: ${(e as Error).message}`);
      for (const { grade } of FUEL_PATTERNS) {
        result.data.push({
          data_type: 'bunker', data_key: `BUNKER_${grade}_${port.toUpperCase()}`,
          data_value: {}, source: 'Ship & Bunker', source_url: url,
          is_complete: false, error_message: (e as Error).message,
        });
      }
    }
  }

  await persistBunkerPrices(allRows).catch(e =>
    console.warn('[bunker_prices] Supabase persist skipped:', (e as Error).message)
  );

  const success = result.data.filter(d => d.is_complete).length;
  console.log(`âœ… bunker: ${success}/${result.data.length}ê°œ ìˆ˜ì§‘ ì™„ë£Œ`);
  return result;
}

if (require.main === module) {
  collect().then(r => snapshotWriter(r)).catch(console.error);
}
