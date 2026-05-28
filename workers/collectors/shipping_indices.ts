// workers/collectors/shipping_indices.ts
// 컨테이너 운임 지수 수집기 — fetch 기반 (Playwright 미사용)
// 대상: BDI (stooq), WCI (Drewry), FBX (Freightos), SCFI/KCCI/CCFI (dashboard-data API)

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
  // WCI_Index_20241.png 같은 이미지 파일명을 잘못 잡지 않도록 per/slash FEU만 허용
  const valuePats = [
    /\$\s*([\d,]+(?:\.\d+)?)\s+per\s+(?:FEU|40')/i,  // $2,711.77 per FEU
    /\$\s*([\d,]+(?:\.\d+)?)\s*\/\s*FEU/i,            // $2,712/FEU (슬래시형)
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
    console.log('[WCI] 파싱 실패 — HTML 앞 500자:', html.slice(0, 500));
  }

  return [{
    name: 'WCI_종합',
    value,
    change_pct,
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

// ── SCFI / KCCI / CCFI — dashboard-data API ───────────────────────
// DASHBOARD_ANON_KEY: zidkckbabtajpgkhxmfm 프로젝트 anon key (공개키)
interface DashboardResponse {
  kcci: { current: number; weeklyGrowth: number; date: string } | null;
  scfi: { current: number; weeklyGrowth: number; date: string } | null;
  ccfi: { current: number; weeklyGrowth: number; date: string } | null;
  fetchedAt: string;
}

async function fetchDashboardData(): Promise<IndexData[]> {
  const key = process.env.DASHBOARD_ANON_KEY;
  if (!key) {
    console.log('⚠️ DASHBOARD_ANON_KEY 미설정 — SCFI/KCCI/CCFI 수집 스킵');
    return [
      { name: 'SCFI_종합', value: null, change_pct: null, date: TODAY, unit: 'point',
        source: 'Shanghai Shipping Exchange', source_url: 'https://en.sse.net.cn/indices/scfinew.jsp',
        note: 'DASHBOARD_ANON_KEY 미설정' },
      { name: 'KCCI_종합', value: null, change_pct: null, date: TODAY, unit: 'point',
        source: 'KOBC', source_url: 'https://www.kobc.or.kr/index/kcci',
        note: 'DASHBOARD_ANON_KEY 미설정' },
      { name: 'CCFI_종합', value: null, change_pct: null, date: TODAY, unit: 'point',
        source: 'Shanghai Shipping Exchange', source_url: 'https://en.sse.net.cn/indices/ccfinew.jsp',
        note: 'DASHBOARD_ANON_KEY 미설정' },
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
      name: 'SCFI_종합',
      value: data.scfi?.current ?? null,
      change_pct: data.scfi?.weeklyGrowth ?? null,
      date: data.scfi?.date ?? TODAY,
      unit: 'point',
      source: 'Shanghai Shipping Exchange (via dashboard)',
      source_url: 'https://en.sse.net.cn/indices/scfinew.jsp',
    },
    {
      name: 'KCCI_종합',
      value: data.kcci?.current ?? null,
      change_pct: data.kcci?.weeklyGrowth ?? null,
      date: data.kcci?.date ?? TODAY,
      unit: 'point',
      source: 'KOBC (via dashboard)',
      source_url: 'https://www.kobc.or.kr/index/kcci',
    },
    {
      name: 'CCFI_종합',
      value: data.ccfi?.current ?? null,
      change_pct: data.ccfi?.weeklyGrowth ?? null,
      date: data.ccfi?.date ?? TODAY,
      unit: 'point',
      source: 'Shanghai Shipping Exchange (via dashboard)',
      source_url: 'https://en.sse.net.cn/indices/ccfinew.jsp',
    },
  ];
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
  // Sanity check: WCI/FBX historical range ~800–8000 $/FEU
  const sanitized = rows.filter(r => {
    const code = String(r.index_code);
    const val  = Number(r.value);
    if ((code === 'WCI' || code === 'FBX') && (val < 500 || val > 15000)) {
      console.warn(`[freight_indices] ${code} 값 범위 초과 → 스킵 (${val})`);
      return false;
    }
    return true;
  });
  await dbUpsert('freight_indices', sanitized, 'index_code,week_date');
}

export async function collect(): Promise<CollectorResult> {
  const result: CollectorResult = { section: 'shipping', data: [] };

  // SCFI + KCCI + CCFI — dashboard-data API (병렬 중 첫 번째)
  const [dashRes, bdiRes, wciRes, fbxRes] = await Promise.allSettled([
    rateLimited(DASHBOARD_URL, () => fetchDashboardData()),
    rateLimited('https://stooq.com',          () => fetchBDI()),
    rateLimited('https://www.drewry.co.uk',   () => fetchWCI()),
    rateLimited('https://fbx.freightos.com',  () => fetchFBX()),
  ]);

  // dashboard 결과 먼저 처리
  if (dashRes.status === 'rejected') {
    console.warn(`⚠️ dashboard-data 실패: ${(dashRes.reason as Error).message}`);
    // 실패 시 null 항목으로 기록
    for (const name of ['SCFI_종합', 'KCCI_종합', 'CCFI_종합']) {
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
        error_message: d.value === null ? (d.note ?? '데이터 없음') : undefined,
      });
    }
  }

  // BDI + WCI + FBX 결과 처리
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
