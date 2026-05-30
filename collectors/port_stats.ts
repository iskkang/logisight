// collectors/port_stats.ts
// í•­ë§Œ ì›”ê°„ TEU í†µê³„ ìˆ˜ì§‘ê¸° â€” Supabase port_throughput í…Œì´ë¸”ì— ì§ì ‘ ì €ìž¥
// ì†ŒìŠ¤: Port of LA, Port of LB (HTML íŒŒì‹±), Singapore (CSV)

import { rateLimited } from './utils/rate_limiter';
import { dbUpsert } from './utils/supabase_writer';
import type { CollectorResult } from './types';

const BOT_HEADERS = { 'User-Agent': 'Logisight/1.0 (logisight.mtlship.com; stats-bot)' };
const TODAY = new Date();
const YEAR  = TODAY.getUTCFullYear();
const MONTH = TODAY.getUTCMonth() + 1;

interface PortRow {
  port_code: string;
  year: number;
  month: number;
  teu: number | null;
  source: string;
  source_url: string;
}

// â”€â”€ Port of LA â€” HTML í…Œì´ë¸”ì—ì„œ ìµœì‹  TEU íŒŒì‹± â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function fetchPortLA(): Promise<PortRow | null> {
  const url = 'https://portoflosangeles.org/business/statistics/container-statistics';
  const res = await fetch(url, { headers: BOT_HEADERS, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  // ìµœì‹  ì—°ë„ TEU ìˆ«ìž íŒ¨í„´ (ì˜ˆ: "1,234,567")
  const match = html.match(/(\d{1,3}(?:,\d{3})+)\s*(?:TEU|teu)/i);
  const teu = match ? parseInt(match[1].replace(/,/g, ''), 10) : null;
  return { port_code: 'LA', year: YEAR, month: MONTH - 1 || 12, teu, source: 'Port of LA', source_url: url };
}

// â”€â”€ Port of Long Beach â€” HTML íŒŒì‹± â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function fetchPortLB(): Promise<PortRow | null> {
  const url = 'https://polb.com/business/port-statistics/';
  const res = await fetch(url, { headers: BOT_HEADERS, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  const match = html.match(/(\d{1,3}(?:,\d{3})+)\s*(?:TEU|teu)/i);
  const teu = match ? parseInt(match[1].replace(/,/g, ''), 10) : null;
  return { port_code: 'LB', year: YEAR, month: MONTH - 1 || 12, teu, source: 'Port of Long Beach', source_url: url };
}

// â”€â”€ Singapore MPA â€” data.gov.sg CSV â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function fetchSingapore(): Promise<PortRow | null> {
  const url = 'https://data.gov.sg/datasets/d_da030f7028200d19ffcbe4a2d71af39c/view';
  try {
    const res = await fetch(url, { headers: BOT_HEADERS, signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    // CSV: ìµœì‹  í–‰ì—ì„œ TEU ì¶”ì¶œ
    const lines = text.trim().split('\n').filter(l => l.trim());
    const lastLine = lines[lines.length - 1];
    const parts = lastLine.split(',');
    const teu = parts.length >= 2 ? parseInt(parts[parts.length - 1].trim().replace(/"/g, ''), 10) : null;
    return { port_code: 'SGP', year: YEAR, month: MONTH - 1 || 12, teu: isNaN(teu ?? NaN) ? null : teu, source: 'Singapore MPA', source_url: url };
  } catch {
    return null;
  }
}

export async function collect(): Promise<CollectorResult> {
  const result: CollectorResult = { section: 'shipping', data: [] };
  const rows: PortRow[] = [];

  const fetchers = [
    { name: 'Port of LA', fn: () => fetchPortLA() },
    { name: 'Port of LB', fn: () => fetchPortLB() },
    { name: 'Singapore',  fn: () => fetchSingapore() },
  ];

  for (const f of fetchers) {
    try {
      const row = await rateLimited(f.name, f.fn);
      if (row && row.teu !== null) {
        rows.push(row);
        result.data.push({ data_type: 'port_stat', data_key: `PORT_${row.port_code}`, data_value: row, source: row.source, source_url: row.source_url, is_complete: true });
        console.log(`âœ… ${f.name}: ${row.teu?.toLocaleString()} TEU (${row.year}-${String(row.month).padStart(2, '0')})`);
      } else {
        console.log(`âš ï¸ ${f.name}: TEU íŒŒì‹± ì‹¤íŒ¨`);
        result.data.push({ data_type: 'port_stat', data_key: `PORT_${f.name}_error`, data_value: {}, source: f.name, source_url: '', is_complete: false, error_message: 'TEU íŒŒì‹± ì‹¤íŒ¨' });
      }
    } catch (e) {
      console.log(`âš ï¸ ${f.name} ì‹¤íŒ¨: ${(e as Error).message}`);
      result.data.push({ data_type: 'port_stat', data_key: `PORT_${f.name}_error`, data_value: {}, source: f.name, source_url: '', is_complete: false, error_message: (e as Error).message });
    }
  }

  if (rows.length > 0) {
    await dbUpsert('port_throughput', rows as unknown as Record<string, unknown>[], 'port_code,year,month').catch(e =>
      console.warn('[port_throughput] Supabase persist skipped:', (e as Error).message)
    );
  }

  const success = result.data.filter(d => d.is_complete).length;
  console.log(`\nâœ… port_stats: ${success}/${result.data.length}ê°œ ìˆ˜ì§‘ ì™„ë£Œ`);
  return result;
}

if (require.main === module) {
  collect().catch(console.error);
}
