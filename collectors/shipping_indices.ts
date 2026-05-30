// collectors/shipping_indices.ts
// ì»¨í…Œì´ë„ˆ ìš´ìž„ ì§€ìˆ˜ ìˆ˜ì§‘ê¸° â€” fetch ê¸°ë°˜ (Playwright ë¯¸ì‚¬ìš©)
// ëŒ€ìƒ: BDI (stooq), WCI (Drewry), FBX (Freightos), SCFI/KCCI/CCFI (dashboard-data API)

import { rateLimited } from './utils/rate_limiter';
import { snapshotWriter } from './utils/snapshot_writer';
import { dbUpsert } from './utils/supabase_writer';
import type { CollectorResult } from './types';

interface IndexData {
  name: string;
  value: number | null;
  change_pct: number | null;
  date: string;
  unit: string;
  source: string;
  source_url: string;
  note?: string;
}

const TODAY = new Date().toISOString().slice(0, 10);

const DASHBOARD_URL = 'https://zidkckbabtajpgkhxmfm.supabase.co/functions/v1/dashboard-data';

// Converts any date string to the Monday of its ISO week (YYYY-MM-DD)
function toMonday(dateStr: string): string {
  const d = new Date(dateStr);
  const day = d.getUTCDay();                   // 0=Sun â€¦ 6=Sat
  const diff = day === 0 ? -6 : 1 - day;      // distance back to Monday
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}

// â”€â”€ BDI (Baltic Dry Index) â€” stooq.com ë¬´ë£Œ CSV â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function fetchBDI(): Promise<IndexData[]> {
  const url = 'https://stooq.com/q/l/?s=^bdi&f=sd2t2ohlcv&e=csv';
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Logisight/1.0' },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const csv = await res.text();
  // Format: Symbol,Date,Open,High,Low,Close,Volume
  //         ^BDI,2026-05-23,1234.00,...,1245.00,0
  const lines = csv.trim().split('\n');
  if (lines.length < 2) throw new Error('BDI CSV: too short');
  const parts = lines[1].split(',');
  const dateStr = parts[1]?.trim();
  const close   = parts[5]?.trim();
  if (!close || close === 'N/D' || !dateStr) throw new Error('BDI: N/D or missing');
  return [{
    name: 'BDI_ì¢…í•©',
    value: parseFloat(close),
    change_pct: null,
    date: dateStr,
    unit: 'point',
    source: 'stooq.com',
    source_url: 'https://stooq.com/q/?s=^bdi',
  }];
}

// â”€â”€ WCI (Drewry) â€” ë¬´ë£Œ ê³µê°œ í—¤ë“œë¼ì¸ â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function fetchWCI(): Promise<IndexData[]> {
  const url = 'https://www.drewry.co.uk/supply-chain-advisors/supply-chain-expertise/world-container-index-assessed-by-drewry';
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; Logisight/1.0; +https://logisight.mtlship.com)',
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();

  // Drewry HTML format: "$2,711.77 per FEU" (not "/FEU")
  // WCI_Index_20241.png ê°™ì€ ì´ë¯¸ì§€ íŒŒì¼ëª…ì„ ìž˜ëª» ìž¡ì§€ ì•Šë„ë¡ per/slash FEUë§Œ í—ˆìš©
  const valuePats = [
    /\$\s*([\d,]+(?:\.\d+)?)\s+per\s+(?:FEU|40')/i,  // $2,711.77 per FEU
    /\$\s*([\d,]+(?:\.\d+)?)\s*\/\s*FEU/i,            // $2,712/FEU (ìŠ¬ëž˜ì‹œí˜•)
    /composite[^<$]{0,120}\$([\d,]+(?:\.\d+)?)/i,     // composite ... $2,712
    /"composite"\s*:\s*([\d.]+)/i,                     // JSON "composite": 2711.77
  ];
  const changePats = [
    /([+-]?\d+(?:\.\d+)?)\s*%\s*w[\s/]?w/i,           // +3.1% w/w
    /([+-]?\d+(?:\.\d+)?)\s*%\s*week/i,
    /week[^<$]{0,60}?([+-]?\d+(?:\.\d+)?)\s*%/i,
  ];

  let value: number | null = null;
  let change_pct: number | null = null;

  for (const p of valuePats) {
    const m = html.match(p);
    if (m) { value = parseFloat(m[1].replace(/,/g, '')); break; }
  }
  for (const p of changePats) {
    const m = html.match(p);
    if (m) { change_pct = parseFloat(m[1]); break; }
  }

  if (value === null) {
    console.log('[WCI] íŒŒì‹± ì‹¤íŒ¨ â€” HTML ì•ž 500ìž:', html.slice(0, 500));
  }

  return [{
    name: 'WCI_ì¢…í•©',
    value,
    change_pct,
    date: TODAY,
    unit: '$/FEU',
    source: 'Drewry WCI',
    source_url: url,
  }];
}

// â”€â”€ FBX (Freightos) â€” ê³µê°œ ë°ì´í„° â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function fetchFBX(): Promise<IndexData[]> {
  const url = 'https://fbx.freightos.com/';
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Logisight/1.0 (logisight.mtlship.com; bot)' },
      signal: AbortSignal.timeout(10000),
    });
    const html = await res.text();
    const match = html.match(/FBX.*?([\d,]+(?:\.\d+)?)/i);
    return [{
      name: 'FBX_ê¸€ë¡œë²Œ',
      value: match ? parseFloat(match[1].replace(/,/g, '')) : null,
      change_pct: null,
      date: TODAY,
      unit: '$/FEU',
      source: 'Freightos FBX',
      source_url: url,
    }];
  } catch {
    return [{ name: 'FBX_ê¸€ë¡œë²Œ', value: null, change_pct: null, date: TODAY, unit: '$/FEU', source: 'Freightos FBX', source_url: url }];
  }
}

// â”€â”€ SCFI / KCCI / CCFI â€” dashboard-data API â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// DASHBOARD_ANON_KEY: zidkckbabtajpgkhxmfm í”„ë¡œì íŠ¸ anon key (ê³µê°œí‚¤)
interface DashboardResponse {
  kcci: { current: number; weeklyGrowth: number; date: string } | null;
  scfi: { current: number; weeklyGrowth: number; date: string } | null;
  ccfi: { current: number; weeklyGrowth: number; date: string } | null;
  fetchedAt: string;
}

async function fetchDashboardData(): Promise<IndexData[]> {
  const key = process.env.DASHBOARD_ANON_KEY;
  if (!key) {
    console.log('âš ï¸ DASHBOARD_ANON_KEY ë¯¸ì„¤ì • â€” SCFI/KCCI/CCFI ìˆ˜ì§‘ ìŠ¤í‚µ');
    return [
      { name: 'SCFI_ì¢…í•©', value: null, change_pct: null, date: TODAY, unit: 'point',
        source: 'Shanghai Shipping Exchange', source_url: 'https://en.sse.net.cn/indices/scfinew.jsp',
        note: 'DASHBOARD_ANON_KEY ë¯¸ì„¤ì •' },
      { name: 'KCCI_ì¢…í•©', value: null, change_pct: null, date: TODAY, unit: 'point',
        source: 'KOBC', source_url: 'https://www.kobc.or.kr/index/kcci',
        note: 'DASHBOARD_ANON_KEY ë¯¸ì„¤ì •' },
      { name: 'CCFI_ì¢…í•©', value: null, change_pct: null, date: TODAY, unit: 'point',
        source: 'Shanghai Shipping Exchange', source_url: 'https://en.sse.net.cn/indices/ccfinew.jsp',
        note: 'DASHBOARD_ANON_KEY ë¯¸ì„¤ì •' },
    ];
  }
  const res = await fetch(DASHBOARD_URL, {
    headers: { Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`dashboard-data HTTP ${res.status}`);
  const data = await res.json() as DashboardResponse;

  return [
    {
      name: 'SCFI_ì¢…í•©',
      value: data.scfi?.current ?? null,
      change_pct: data.scfi?.weeklyGrowth ?? null,
      date: data.scfi?.date ?? TODAY,
      unit: 'point',
      source: 'Shanghai Shipping Exchange (via dashboard)',
      source_url: 'https://en.sse.net.cn/indices/scfinew.jsp',
    },
    {
      name: 'KCCI_ì¢…í•©',
      value: data.kcci?.current ?? null,
      change_pct: data.kcci?.weeklyGrowth ?? null,
      date: data.kcci?.date ?? TODAY,
      unit: 'point',
      source: 'KOBC (via dashboard)',
      source_url: 'https://www.kobc.or.kr/index/kcci',
    },
    {
      name: 'CCFI_ì¢…í•©',
      value: data.ccfi?.current ?? null,
      change_pct: data.ccfi?.weeklyGrowth ?? null,
      date: data.ccfi?.date ?? TODAY,
      unit: 'point',
      source: 'Shanghai Shipping Exchange (via dashboard)',
      source_url: 'https://en.sse.net.cn/indices/ccfinew.jsp',
    },
  ];
}

// â”€â”€ Supabase ì˜êµ¬ ì €ìž¥ â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function persistFreightIndices(result: CollectorResult): Promise<void> {
  const rows: Record<string, unknown>[] = [];
  for (const d of result.data) {
    const v = d.data_value as IndexData;
    if (v.value == null) continue;                     // null â†’ ì €ìž¥ ì•ˆ í•¨
    const code = v.name.split('_')[0];                 // 'BDI_ì¢…í•©' â†’ 'BDI'
    rows.push({
      index_code: code,
      value:      v.value,
      week_date:  toMonday(v.date),
      change_pct: v.change_pct ?? null,
      source:     v.source,
      source_url: v.source_url ?? null,
    });
  }
  // Sanity check: WCI/FBX historical range ~800â€“8000 $/FEU
  const sanitized = rows.filter(r => {
    const code = String(r.index_code);
    const val  = Number(r.value);
    if ((code === 'WCI' || code === 'FBX') && (val < 500 || val > 15000)) {
      console.warn(`[freight_indices] ${code} ê°’ ë²”ìœ„ ì´ˆê³¼ â†’ ìŠ¤í‚µ (${val})`);
      return false;
    }
    return true;
  });
  await dbUpsert('freight_indices', sanitized, 'index_code,week_date');
}

export async function collect(): Promise<CollectorResult> {
  const result: CollectorResult = { section: 'shipping', data: [] };

  // SCFI + KCCI + CCFI â€” dashboard-data API (ë³‘ë ¬ ì¤‘ ì²« ë²ˆì§¸)
  const [dashRes, bdiRes, wciRes, fbxRes] = await Promise.allSettled([
    rateLimited(DASHBOARD_URL, () => fetchDashboardData()),
    rateLimited('https://stooq.com',          () => fetchBDI()),
    rateLimited('https://www.drewry.co.uk',   () => fetchWCI()),
    rateLimited('https://fbx.freightos.com',  () => fetchFBX()),
  ]);

  // dashboard ê²°ê³¼ ë¨¼ì € ì²˜ë¦¬
  if (dashRes.status === 'rejected') {
    console.warn(`âš ï¸ dashboard-data ì‹¤íŒ¨: ${(dashRes.reason as Error).message}`);
    // ì‹¤íŒ¨ ì‹œ null í•­ëª©ìœ¼ë¡œ ê¸°ë¡
    for (const name of ['SCFI_ì¢…í•©', 'KCCI_ì¢…í•©', 'CCFI_ì¢…í•©']) {
      result.data.push({
        data_type: 'index', data_key: name,
        data_value: { name, value: null, change_pct: null, date: TODAY, unit: 'point', source: 'dashboard-data', source_url: DASHBOARD_URL },
        source: 'dashboard-data', source_url: DASHBOARD_URL,
        is_complete: false, error_message: (dashRes.reason as Error).message,
      });
    }
  } else {
    for (const d of dashRes.value) {
      result.data.push({
        data_type: 'index', data_key: d.name, data_value: d,
        source: d.source, source_url: d.source_url,
        is_complete: d.value !== null,
        error_message: d.value === null ? (d.note ?? 'ë°ì´í„° ì—†ìŒ') : undefined,
      });
    }
  }

  // BDI + WCI + FBX ê²°ê³¼ ì²˜ë¦¬
  for (const [label, res] of [['BDI', bdiRes], ['WCI', wciRes], ['FBX', fbxRes]] as const) {
    if (res.status === 'rejected') {
      console.log(`âš ï¸ ${label} ì‹¤íŒ¨: ${(res.reason as Error).message}`);
      continue;
    }
    for (const d of res.value as IndexData[]) {
      result.data.push({ data_type: 'index', data_key: d.name, data_value: d,
        source: d.source, source_url: d.source_url, is_complete: d.value !== null,
        error_message: d.value === null ? 'ë°ì´í„° íŒŒì‹± ì‹¤íŒ¨' : undefined });
    }
  }

  const success = result.data.filter(d => d.is_complete).length;
  console.log(`âœ… shipping_indices: ${success}/${result.data.length}ê°œ ìˆ˜ì§‘ ì™„ë£Œ`);

  // Supabase persist (ì—ëŸ¬ê°€ ë°œìƒí•´ë„ snapshotWriter ê²½ë¡œëŠ” ì˜í–¥ ì—†ìŒ)
  await persistFreightIndices(result).catch(e =>
    console.warn('[freight_indices] Supabase persist skipped:', (e as Error).message)
  );

  return result;
}

if (require.main === module) {
  collect().then(r => snapshotWriter(r)).catch(console.error);
}
