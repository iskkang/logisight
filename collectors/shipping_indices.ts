// collectors/shipping_indices.ts
// 컨테이너 운임 지수 수집기 — fetch 기반 (Playwright 미사용)
// 대상: WCI (Drewry, 주간), FBX (Freightos, 주간), SCFI/KCCI/CCFI (dashboard-data API)
// BDI는 freight_index_excel(oneksa)가 담당 — stooq는 봇 차단으로 사용 불가

import { rateLimited } from './utils/rate_limiter';
import { snapshotWriter } from './utils/snapshot_writer';
import { dbUpsert } from './utils/supabase_writer';
import type { CollectorResult } from './types';

interface IndexData {
  code: string;            // freight_indices.index_code 그대로 (예: 'WCI', 'WCI_SHA_LAX')
  name: string;            // 스냅샷용 표시명
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
// 공개 anon key (role: anon — 프론트엔드 번들과 동일하게 공개 가능). env 우선, 미설정 시 fallback.
const DASHBOARD_ANON_KEY_FALLBACK =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InppZGtja2JhYnRhanBna2h4bWZtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc1MzAyMjMsImV4cCI6MjA5MzEwNjIyM30.1Q0S_HrqUPCo6TH5Yym753mnW4xVYHzLRl1nBqG14KU';

// Converts any date string to the Monday of its ISO week (YYYY-MM-DD)
function toMonday(dateStr: string): string {
  const d = new Date(dateStr);
  const day = d.getUTCDay();                   // 0=Sun … 6=Sat
  const diff = day === 0 ? -6 : 1 - day;      // distance back to Monday
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}

// ── WCI (Drewry) — 무료 공개 주간 헤드라인 (목요일 발표) ────────────
// Drewry 페이지 본문 예:
//   "Our detailed assessment for Thursday, 04 Jun 2026 The Drewry World Container Index (WCI) ...
//    surged 23% to $3,433 per 40ft container ... Shanghai to Los Angeles rising 31% to $4,565 ..."
const WCI_LANES: Array<{ phrase: string; code: string; name: string }> = [
  { phrase: 'Shanghai to Rotterdam',   code: 'WCI_SHA_RTM', name: 'WCI 상하이-로테르담' },
  { phrase: 'Shanghai to Genoa',       code: 'WCI_SHA_GOA', name: 'WCI 상하이-제노바' },
  { phrase: 'Shanghai to Los Angeles', code: 'WCI_SHA_LAX', name: 'WCI 상하이-로스앤젤레스' },
  { phrase: 'Shanghai to New York',    code: 'WCI_SHA_NYC', name: 'WCI 상하이-뉴욕' },
];
const MONTHS: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
};
const WCI_UP = /surg|jump|ros|rise|risen|rising|clim|increas|gain|grew|grow|up\b/i;
const WCI_DOWN = /fell|fall|drop|declin|decreas|slip|eas|sank|sink|down\b|lower/i;

async function fetchWCI(): Promise<IndexData[]> {
  const url = 'https://www.drewry.co.uk/supply-chain-advisors/supply-chain-expertise/world-container-index-assessed-by-drewry';
  // Drewry는 CI 러너 IP에 HTTP 429를 자주 반환 → 브라우저 헤더 + 429/503 백오프 재시도.
  const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
  let res: Response | null = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    res = await fetch(url, {
      headers: {
        'User-Agent': UA,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://www.drewry.co.uk/',
      },
      signal: AbortSignal.timeout(15000),
    });
    if (res.ok) break;
    if ((res.status === 429 || res.status === 503) && attempt < 3) {
      await new Promise((r) => setTimeout(r, 3000 * attempt)); // 3s, 6s
      continue;
    }
    throw new Error(`HTTP ${res.status}`);
  }
  if (!res || !res.ok) throw new Error('WCI fetch 실패');
  const html = await res.text();
  // 태그/스크립트 제거 후 평문에서 파싱 (마크업 변동에 강함)
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // 발표일: "assessment for Thursday, 04 Jun 2026" → 2026-06-04
  let date = TODAY;
  const dm = text.match(/assessment for\s+\w+,\s+(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{4})/i);
  if (dm) {
    const mm = MONTHS[dm[2].slice(0, 3).toLowerCase()];
    if (mm) date = `${dm[3]}-${mm}-${dm[1].padStart(2, '0')}`;
  }

  // 종합: "$3,433 per 40ft" (Drewry는 FEU 대신 "40ft container" 표기)
  const compM = text.match(/\$\s*([\d,]+(?:\.\d+)?)\s*per\s*40\s*ft/i);
  const composite = compM ? parseFloat(compM[1].replace(/,/g, '')) : null;

  // 종합 변화율: "(WCI) ... surged 23% to $3,433" — 동사로 부호 결정
  let change_pct: number | null = null;
  const chgM = text.match(
    /World Container Index[\s\S]{0,120}?\b([A-Za-z]+)\s+(\d+(?:\.\d+)?)\s*%\s+to\s+\$/i
  );
  if (chgM) {
    const mag = parseFloat(chgM[2]);
    change_pct = WCI_DOWN.test(chgM[1]) ? -mag : (WCI_UP.test(chgM[1]) ? mag : mag);
  }

  if (composite === null) {
    console.log('[WCI] 종합 파싱 실패 — 평문 앞 400자:', text.slice(0, 400));
  }

  const rows: IndexData[] = [{
    code: 'WCI', name: 'WCI_종합', value: composite, change_pct,
    date, unit: '$/40ft', source: 'Drewry WCI', source_url: url,
  }];

  // 레인별: "Shanghai to Los Angeles rising 31% to $4,565"
  for (const lane of WCI_LANES) {
    const re = new RegExp(lane.phrase.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&') + '[^$]{0,80}\\$\\s*([\\d,]+(?:\\.\\d+)?)', 'i');
    const m = text.match(re);
    if (!m) continue;
    rows.push({
      code: lane.code, name: lane.name,
      value: parseFloat(m[1].replace(/,/g, '')),
      change_pct: null, date, unit: '$/40ft',
      source: 'Drewry WCI', source_url: url,
    });
  }

  return rows;
}

// ── FBX (Freightos) — 홈페이지에 임베드된 글로벌 시계열 JSON ────────
// 임베드 형식: {"ticker":"FBX","indexDate":"2026-05-29","value":2234.75}
// 시계열을 단일 진실원천으로 사용: 최신 점(값·날짜)과 직전 점으로 WoW 변화율을 자체 계산.
//   (헤드라인 위젯은 최신 점보다 한 주 늦게 갱신될 수 있어 신뢰하지 않음)
// 값이 안 잡히면 value=null 로 반환 → persist 가 건너뛰어 빈 행을 만들지 않는다.
async function fetchFBX(): Promise<IndexData[]> {
  const url = 'https://fbx.freightos.com/';
  const empty: IndexData[] = [{
    code: 'FBX', name: 'FBX_글로벌', value: null, change_pct: null,
    date: TODAY, unit: '$/FEU', source: 'Freightos FBX', source_url: url,
  }];
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Logisight/1.0; +https://logisight.mtlship.com)' },
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();

    // 글로벌 FBX 시계열(날짜 오름차순 정렬)
    const pts = [...html.matchAll(/\{"ticker":"FBX","indexDate":"(\d{4}-\d{2}-\d{2})","value":([\d.]+)\}/g)]
      .map(m => ({ date: m[1], value: parseFloat(m[2]) }))
      .filter(p => Number.isFinite(p.value))
      .sort((a, b) => (a.date < b.date ? -1 : 1));
    if (pts.length === 0) {
      console.log('[FBX] 시계열 파싱 실패 — 빈 값 반환');
      return empty;
    }
    const latest = pts[pts.length - 1];
    const prev = pts.length >= 2 ? pts[pts.length - 2] : null;
    const change_pct = prev && prev.value
      ? Math.round((latest.value / prev.value - 1) * 10000) / 100  // 소수 2자리 %
      : null;

    return [{
      code: 'FBX', name: 'FBX_글로벌', value: latest.value, change_pct,
      date: latest.date, unit: '$/FEU', source: 'Freightos FBX', source_url: url,
    }];
  } catch (e) {
    console.log(`[FBX] 수집 실패: ${(e as Error).message}`);
    return empty;
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
  const key = process.env.DASHBOARD_ANON_KEY || DASHBOARD_ANON_KEY_FALLBACK;
  const res = await fetch(DASHBOARD_URL, {
    headers: { Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`dashboard-data HTTP ${res.status}`);
  const data = await res.json() as DashboardResponse;

  return [
    {
      code: 'SCFI', name: 'SCFI_종합',
      value: data.scfi?.current ?? null,
      change_pct: data.scfi?.weeklyGrowth ?? null,
      date: data.scfi?.date ?? TODAY,
      unit: 'point',
      source: 'Shanghai Shipping Exchange (via dashboard)',
      source_url: 'https://en.sse.net.cn/indices/scfinew.jsp',
    },
    {
      code: 'KCCI', name: 'KCCI_종합',
      value: data.kcci?.current ?? null,
      change_pct: data.kcci?.weeklyGrowth ?? null,
      date: data.kcci?.date ?? TODAY,
      unit: 'point',
      source: 'KOBC (via dashboard)',
      source_url: 'https://www.kobc.or.kr/index/kcci',
    },
    {
      code: 'CCFI', name: 'CCFI_종합',
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
    // null/NaN/Infinity → 저장 안 함 (빈 행·쓰레기 값 방지)
    if (v.value == null || !Number.isFinite(v.value)) continue;
    rows.push({
      index_code: v.code,                              // 명시적 코드 ('WCI', 'WCI_SHA_LAX' 등)
      value:      v.value,
      week_date:  toMonday(v.date),
      change_pct: Number.isFinite(v.change_pct as number) ? v.change_pct : null,
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
  // BDI는 freight_index_excel(oneksa)가 담당하므로 여기서 수집하지 않음
  const [dashRes, wciRes, fbxRes] = await Promise.allSettled([
    rateLimited(DASHBOARD_URL, () => fetchDashboardData()),
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
        data_value: { code: name.split('_')[0], name, value: null, change_pct: null, date: TODAY, unit: 'point', source: 'dashboard-data', source_url: DASHBOARD_URL },
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

  // WCI + FBX 결과 처리
  for (const [label, res] of [['WCI', wciRes], ['FBX', fbxRes]] as const) {
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
