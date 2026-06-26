// collectors/kcci_routes.ts
// KCCI 권역별 항로 운임지수 주간 수집기 — KOBC gridList HTML 표 파싱.
// 대상: KCCI 종합 + 13개 항로(미주서안/동안, 유럽, 지중해, 중동, 호주, 남미동/서안, 남아/서아프리카, 중국, 일본, 동남아).
// 배경: shipping_indices.ts(dashboard API)·freight_index_excel.ts(oneksa)는 KCCI '종합'만 제공.
//       항로 분해는 그동안 backfill_index_history.ts(수동 엑셀)로만 적재돼 정체됨 → 본 수집기로 주간 자동화.
// 전략: gridList.do는 SSR HTML(<table class="TbCommon">)에 14행 전부 포함 — 파라미터 불필요.

import { rateLimited } from './utils/rate_limiter';
import { snapshotWriter } from './utils/snapshot_writer';
import { dbUpsert } from './utils/supabase_writer';
import type { CollectorResult } from './types';

const SOURCE_URL = 'https://www.kobc.or.kr/ebz/shippinginfo/kcci/gridList.do?mId=0304000000';
const BOT_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'ko-KR,ko;q=0.9,en-US,en;q=0.8',
  'Referer': 'https://www.kobc.or.kr/',
};

// KOBC 항로 코드 → freight_indices.index_code (backfill_index_history.ts의 KCCI_MAP과 동일)
const CODE_MAP: Record<string, string> = {
  KCCI: 'KCCI', KUWI: 'KCCI_USWC', KUEI: 'KCCI_USEC', KNEI: 'KCCI_NEU',
  KMDI: 'KCCI_MED', KMEI: 'KCCI_ME', KAUI: 'KCCI_AU', KLEI: 'KCCI_SAE',
  KLWI: 'KCCI_SAW', KSAI: 'KCCI_ZAF', KWAI: 'KCCI_WAF', KCI: 'KCCI_CN',
  KJI: 'KCCI_JP', KSEI: 'KCCI_SEA',
};

function toMonday(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00Z');
  const day = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() + (day === 0 ? -6 : 1 - day));
  return d.toISOString().slice(0, 10);
}
const strip = (s: string) => s.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
function parseNum(raw: string): number | null {
  const s = (raw || '').replace(/,/g, '').trim();
  if (!s || s === '-') return null;
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

export interface KcciRow { code: string; index_code: string; route: string; value: number | null; change_pct: number | null; }
export interface KcciParse { currentDate: string | null; previousDate: string | null; rows: KcciRow[] }

// HTML → 파싱 결과(검증·수집 공용). Code 셀을 앵커로 +3=현재값, +5=주간변동.
export function parseKcciTable(html: string): KcciParse {
  const tm = html.match(/<table class="TbCommon"[\s\S]*?<\/table>/i);
  if (!tm) throw new Error('TbCommon 표 없음');
  const tbl = tm[0];
  const trs = [...tbl.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)]
    .map((tr) => [...tr[1].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi)].map((m) => strip(m[1])));
  if (!trs.length) throw new Error('행 없음');

  // 헤더: "Current Index 2026-06-22" / "Previous Index 2026-06-15"
  const header = trs[0].join(' ');
  const dates = [...header.matchAll(/(\d{4}-\d{2}-\d{2})/g)].map((m) => m[1]);
  const currentDate = dates[0] || null;
  const previousDate = dates[1] || null;

  const rows: KcciRow[] = [];
  for (const cells of trs.slice(1)) {
    const ci = cells.findIndex((c) => CODE_MAP[c]);   // Code 셀 위치(6셀/7셀 무관하게 앵커)
    if (ci < 0) continue;
    const code = cells[ci];
    const route = cells[ci + 1] || '';
    const value = parseNum(cells[ci + 3]);            // Current Index
    const chgCell = cells[ci + 5] || '';              // "838(17.13%)" / "-9(-4.04%)"
    const cm = chgCell.match(/\(\s*(-?\d+(?:\.\d+)?)\s*%\)/);
    const change_pct = cm ? parseFloat(cm[1]) : null;
    rows.push({ code, index_code: CODE_MAP[code], route, value, change_pct });
  }
  return { currentDate, previousDate, rows };
}

async function fetchHtml(): Promise<string> {
  const res = await fetch(SOURCE_URL, { headers: BOT_HEADERS, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

export async function collect(): Promise<CollectorResult> {
  const result: CollectorResult = { section: 'shipping', data: [] };

  let parsed: KcciParse;
  try {
    const html = await rateLimited(SOURCE_URL, () => fetchHtml());
    parsed = parseKcciTable(html);
  } catch (err) {
    const msg = (err as Error).message;
    console.warn(`⚠️ KCCI 항로 수집 실패: ${msg}`);
    result.data.push({ data_type: 'index', data_key: 'KCCI_ROUTES_error', data_value: {}, source: 'KOBC', source_url: SOURCE_URL, is_complete: false, error_message: msg });
    return result;
  }

  if (!parsed.currentDate) {
    result.data.push({ data_type: 'index', data_key: 'KCCI_ROUTES_error', data_value: {}, source: 'KOBC', source_url: SOURCE_URL, is_complete: false, error_message: '발표일 파싱 실패' });
    return result;
  }
  const weekDate = toMonday(parsed.currentDate);

  const dbRows: Record<string, unknown>[] = [];
  for (const r of parsed.rows) {
    if (r.value == null || !Number.isFinite(r.value) || r.value <= 0) continue;  // KCCI_CN=54 등 저값은 유효
    dbRows.push({
      index_code: r.index_code, value: r.value, week_date: weekDate,
      change_pct: Number.isFinite(r.change_pct as number) ? r.change_pct : null,
      source: 'KOBC KCCI', source_url: SOURCE_URL,
    });
    result.data.push({
      data_type: 'index', data_key: `KCCI_${r.index_code}_${parsed.currentDate}`,
      data_value: { name: r.index_code, value: r.value, date: parsed.currentDate, source: 'KOBC KCCI', source_url: SOURCE_URL },
      source: 'KOBC KCCI', source_url: SOURCE_URL, is_complete: true,
    });
  }

  console.log(`✅ kcci_routes (KOBC): ${dbRows.length}계열 @ ${parsed.currentDate} (week ${weekDate})`);
  await dbUpsert('freight_indices', dbRows, 'index_code,week_date').catch((e) =>
    console.warn('[freight_indices] KCCI 항로 persist 실패:', (e as Error).message));

  return result;
}

if (require.main === module) {
  collect().then((r) => snapshotWriter(r)).catch(console.error);
}
