// collectors/port_stats.ts
// 항만 월간 TEU 통계 수집기 — Supabase port_throughput 테이블에 직접 저장
// 소스: Port of LA, Port of LB (HTML 파싱), Singapore (CSV), KOSIS 해양수산부 (한국 항만)

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

// ── KOSIS 해양수산부 — 한국 항만별 컨테이너 처리실적 ──────────────────
const KOSIS_PORT_MAP: Record<string, string> = {
  '합 계':  'KR_ALL',
  '부산':   'KRPUS',
  '인천':   'KRICN',
  '광양':   'KRGMP',
  '평택':   'KRPTK',
  '울산':   'KRULS',
  '포항':   'KRPOH',
  '마산':   'KRMTN',
  '군산':   'KRKUN',
  '목포':   'KRMOK',
};

async function fetchKoreanPorts(): Promise<PortRow[]> {
  const url =
    'https://kosis.kr/openapi/Param/statisticsParameterData.do' +
    '?method=getList&apiKey=&itmId=T002+T004+T005+&objL1=ALL' +
    '&format=json&jsonVD=Y&prdSe=M&newEstPrdCnt=13&orgId=134&tblId=DT_134001_002';

  const res = await fetch(url, { headers: BOT_HEADERS, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`KOSIS HTTP ${res.status}`);
  const data: Array<{ C1_NM: string; ITM_ID: string; PRD_DE: string; DT?: string }> = await res.json();

  const map = new Map<string, PortRow>();
  for (const item of data) {
    const portCode = KOSIS_PORT_MAP[item.C1_NM];
    if (!portCode) continue;
    const year  = parseInt(item.PRD_DE.slice(0, 4), 10);
    const month = parseInt(item.PRD_DE.slice(4, 6), 10);
    const teu   = parseInt((item.DT ?? '0').replace(/,/g, ''), 10);
    const mapKey = `${portCode}_${year}_${month}`;
    const existing = map.get(mapKey);
    if (existing) {
      existing.teu = (existing.teu ?? 0) + teu;
    } else {
      map.set(mapKey, { port_code: portCode, year, month, teu, source: 'KOSIS 해양수산부', source_url: 'https://kosis.kr' });
    }
  }
  return [...map.values()];
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

  // KOSIS 한국 항만 데이터 수집
  try {
    const krRows = await fetchKoreanPorts();
    if (krRows.length > 0) {
      await dbUpsert('port_throughput', krRows as unknown as Record<string, unknown>[], 'port_code,year,month');
      console.log(`✅ 한국 항만: ${krRows.length}건 저장`);
      result.data.push({ data_type: 'port_stat', data_key: 'PORT_KR_KOSIS', data_value: { count: krRows.length }, source: 'KOSIS 해양수산부', source_url: 'https://kosis.kr', is_complete: true });
    }
  } catch (e) {
    console.warn(`⚠️ KOSIS 한국 항만 실패: ${(e as Error).message}`);
    result.data.push({ data_type: 'port_stat', data_key: 'PORT_KR_KOSIS_error', data_value: {}, source: 'KOSIS 해양수산부', source_url: 'https://kosis.kr', is_complete: false, error_message: (e as Error).message });
  }

  const success = result.data.filter(d => d.is_complete).length;
  console.log(`\n✅ port_stats: ${success}/${result.data.length}개 수집 완료`);
  return result;
}

if (require.main === module) {
  collect().catch(console.error);
}
