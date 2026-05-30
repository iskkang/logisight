// collectors/port_stats.ts
// 항만 월간 TEU 통계 수집기 — Supabase port_throughput 테이블에 직접 저장
// 소스: Port of LA, Port of LB (HTML 파싱), Singapore (CSV)

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

// ── Port of LA — HTML 테이블에서 최신 TEU 파싱 ─────────────────────
async function fetchPortLA(): Promise<PortRow | null> {
  const url = 'https://portoflosangeles.org/business/statistics/container-statistics';
  const res = await fetch(url, { headers: BOT_HEADERS, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  // 최신 연도 TEU 숫자 패턴 (예: "1,234,567")
  const match = html.match(/(\d{1,3}(?:,\d{3})+)\s*(?:TEU|teu)/i);
  const teu = match ? parseInt(match[1].replace(/,/g, ''), 10) : null;
  return { port_code: 'LA', year: YEAR, month: MONTH - 1 || 12, teu, source: 'Port of LA', source_url: url };
}

// ── Port of Long Beach — HTML 파싱 ────────────────────────────────
async function fetchPortLB(): Promise<PortRow | null> {
  const url = 'https://polb.com/business/port-statistics/';
  const res = await fetch(url, { headers: BOT_HEADERS, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  const match = html.match(/(\d{1,3}(?:,\d{3})+)\s*(?:TEU|teu)/i);
  const teu = match ? parseInt(match[1].replace(/,/g, ''), 10) : null;
  return { port_code: 'LB', year: YEAR, month: MONTH - 1 || 12, teu, source: 'Port of Long Beach', source_url: url };
}

// ── Singapore MPA — data.gov.sg CSV ───────────────────────────────
async function fetchSingapore(): Promise<PortRow | null> {
  const url = 'https://data.gov.sg/datasets/d_da030f7028200d19ffcbe4a2d71af39c/view';
  try {
    const res = await fetch(url, { headers: BOT_HEADERS, signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    // CSV: 최신 행에서 TEU 추출
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
        console.log(`✅ ${f.name}: ${row.teu?.toLocaleString()} TEU (${row.year}-${String(row.month).padStart(2, '0')})`);
      } else {
        console.log(`⚠️ ${f.name}: TEU 파싱 실패`);
        result.data.push({ data_type: 'port_stat', data_key: `PORT_${f.name}_error`, data_value: {}, source: f.name, source_url: '', is_complete: false, error_message: 'TEU 파싱 실패' });
      }
    } catch (e) {
      console.log(`⚠️ ${f.name} 실패: ${(e as Error).message}`);
      result.data.push({ data_type: 'port_stat', data_key: `PORT_${f.name}_error`, data_value: {}, source: f.name, source_url: '', is_complete: false, error_message: (e as Error).message });
    }
  }

  if (rows.length > 0) {
    await dbUpsert('port_throughput', rows as unknown as Record<string, unknown>[], 'port_code,year,month').catch(e =>
      console.warn('[port_throughput] Supabase persist skipped:', (e as Error).message)
    );
  }

  const success = result.data.filter(d => d.is_complete).length;
  console.log(`\n✅ port_stats: ${success}/${result.data.length}개 수집 완료`);
  return result;
}

if (require.main === module) {
  collect().catch(console.error);
}
