// workers/collectors/shipping_indices.ts
// 컨테이너 운임 지수 수집기 — fetch 기반 (Playwright 미사용)
// 대상: BDI (stooq), WCI (Drewry), FBX (Freightos), SCFI (stub), KCCI (stub)

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

// Converts any date string to the Monday of its ISO week (YYYY-MM-DD)
function toMonday(dateStr: string): string {
  const d = new Date(dateStr);
  const day = d.getUTCDay();                   // 0=Sun … 6=Sat
  const diff = day === 0 ? -6 : 1 - day;      // distance back to Monday
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}

// ── BDI (Baltic Dry Index) — stooq.com 무료 CSV ─────────────────
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
    name: 'BDI_종합',
    value: parseFloat(close),
    change_pct: null,
    date: dateStr,
    unit: 'point',
    source: 'stooq.com',
    source_url: 'https://stooq.com/q/?s=^bdi',
  }];
}

// ── WCI (Drewry) — 무료 공개 헤드라인 ────────────────────────────
async function fetchWCI(): Promise<IndexData[]> {
  const url = 'https://www.drewry.co.uk/supply-chain-advisors/supply-chain-expertise/world-container-index-assessed-by-drewry';
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Logisight/1.0 (logisight.mtlship.com; bot)' },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  const valueMatch  = html.match(/\$\s*([\d,]+(?:\.\d+)?)\s*\/\s*FEU/i);
  const changeMatch = html.match(/([-+]?\d+(?:\.\d+)?)\s*%/);
  return [{
    name: 'WCI_종합',
    value: valueMatch ? parseFloat(valueMatch[1].replace(/,/g, '')) : null,
    change_pct: changeMatch ? parseFloat(changeMatch[1]) : null,
    date: TODAY,
    unit: '$/FEU',
    source: 'Drewry WCI',
    source_url: url,
  }];
}

// ── FBX (Freightos) — 공개 데이터 ────────────────────────────────
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
      name: 'FBX_글로벌',
      value: match ? parseFloat(match[1].replace(/,/g, '')) : null,
      change_pct: null,
      date: TODAY,
      unit: '$/FEU',
      source: 'Freightos FBX',
      source_url: url,
    }];
  } catch {
    return [{ name: 'FBX_글로벌', value: null, change_pct: null, date: TODAY, unit: '$/FEU', source: 'Freightos FBX', source_url: url }];
  }
}

// ── SCFI / KCCI — 자동 수집 불가 stubs ───────────────────────────
function buildSCFIStub(): IndexData[] {
  console.log('⚠️ SCFI 자동 수집 불가 — Shanghai Shipping Exchange 한국 IP 차단');
  return [{ name: 'SCFI_종합', value: null, change_pct: null, date: TODAY, unit: 'point',
    source: 'Shanghai Shipping Exchange', source_url: 'https://en.sse.net.cn/indices/scfinew.jsp',
    note: 'IP 차단 — 수동 입력 필요' }];
}
function buildKCCIStub(): IndexData[] {
  console.log('⚠️ KCCI 자동 수집 불가 — JS 렌더링 사이트');
  return [{ name: 'KCCI_종합', value: null, change_pct: null, date: TODAY, unit: 'point',
    source: 'KOBC', source_url: 'https://www.kobc.or.kr/index/kcci',
    note: 'JS 렌더링 — 수동 입력 필요' }];
}

// ── Supabase 영구 저장 ────────────────────────────────────────────
async function persistFreightIndices(result: CollectorResult): Promise<void> {
  const rows: Record<string, unknown>[] = [];
  for (const d of result.data) {
    const v = d.data_value as IndexData;
    if (v.value == null) continue;                     // null → 저장 안 함
    const code = v.name.split('_')[0];                 // 'BDI_종합' → 'BDI'
    rows.push({
      index_code: code,
      value:      v.value,
      week_date:  toMonday(v.date),
      change_pct: v.change_pct ?? null,
      source:     v.source,
      source_url: v.source_url ?? null,
    });
  }
  await dbUpsert('freight_indices', rows, 'index_code,week_date');
}

export async function collect(): Promise<CollectorResult> {
  const result: CollectorResult = { section: 'shipping', data: [] };

  // Stubs (동기)
  for (const d of [...buildSCFIStub(), ...buildKCCIStub()]) {
    result.data.push({ data_type: 'index', data_key: d.name, data_value: d,
      source: d.source, source_url: d.source_url, is_complete: false, error_message: d.note });
  }

  // BDI + WCI + FBX (병렬 fetch)
  const [bdiRes, wciRes, fbxRes] = await Promise.allSettled([
    rateLimited('https://stooq.com',          () => fetchBDI()),
    rateLimited('https://www.drewry.co.uk',   () => fetchWCI()),
    rateLimited('https://fbx.freightos.com',  () => fetchFBX()),
  ]);

  for (const [label, res] of [['BDI', bdiRes], ['WCI', wciRes], ['FBX', fbxRes]] as const) {
    if (res.status === 'rejected') {
      console.log(`⚠️ ${label} 실패: ${(res.reason as Error).message}`);
      continue;
    }
    for (const d of res.value as IndexData[]) {
      result.data.push({ data_type: 'index', data_key: d.name, data_value: d,
        source: d.source, source_url: d.source_url, is_complete: d.value !== null,
        error_message: d.value === null ? '데이터 파싱 실패' : undefined });
    }
  }

  const success = result.data.filter(d => d.is_complete).length;
  console.log(`✅ shipping_indices: ${success}/${result.data.length}개 수집 완료`);

  // Supabase persist (에러가 발생해도 snapshotWriter 경로는 영향 없음)
  await persistFreightIndices(result).catch(e =>
    console.warn('[freight_indices] Supabase persist skipped:', (e as Error).message)
  );

  return result;
}

if (require.main === module) {
  collect().then(r => snapshotWriter(r)).catch(console.error);
}
