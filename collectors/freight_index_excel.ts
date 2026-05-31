// collectors/freight_index_excel.ts
// oneksa.kr 항로별 운임 지수 수집기 (HTML 테이블 파싱)
// 대상: BDI, KCCI, SCFI(종합/USWC/EU/USEC), HRCI, HSFO, VLSFO
// 전략: /shipping_index HTML 테이블 — 파라미터 불필요, SSR 렌더링
//
// 주의: shipping_indices.ts 의 persistFreightIndices()는 split('_')[0]으로 항로 접미사를 제거.
//       이 collector는 dbUpsert 직접 호출로 SCFI_USWC 등 항로 코드를 그대로 보존한다.

import { rateLimited } from './utils/rate_limiter';
import { snapshotWriter } from './utils/snapshot_writer';
import { dbUpsert } from './utils/supabase_writer';
import type { CollectorResult } from './types';

const SOURCE_URL = 'https://oneksa.kr/shipping_index';
const BOT_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'ko-KR,ko;q=0.9,en-US,en;q=0.8',
  'Referer': 'https://oneksa.kr/',
};

// oneksa 컬럼 헤더 → freight_indices.index_code 매핑 (WS 제외 — 대상 아님)
const COL_MAP: Record<string, string> = {
  'BDI':          'BDI',
  'KCCI':         'KCCI',
  'SCFI':         'SCFI',
  'SCFI(USWC)':   'SCFI_USWC',
  'SCFI(Europe)': 'SCFI_EU',
  'SCFI(USEC)':   'SCFI_USEC',
  'HRCI':         'HRCI',
  'HSFO':         'HSFO',
  'VLSFO':        'VLSFO',
};

function toMonday(dateStr: string): string {
  const d = new Date(dateStr);
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function parseNum(raw: string): number | null {
  const s = raw.replace(/,/g, '').trim();
  if (!s || s === '-') return null;
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

async function fetchTable(): Promise<{ headers: string[]; rows: string[][] }> {
  const res = await fetch(SOURCE_URL, { headers: BOT_HEADERS, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();

  const tableMatch = html.match(/<table[\s\S]*?<\/table>/i);
  if (!tableMatch) throw new Error('테이블 블록 없음');
  const table = tableMatch[0];

  // 헤더: <thead> 내 <tr> 또는 첫 번째 <tr>
  const theadMatch = table.match(/<thead[\s\S]*?<\/thead>/i);
  const headerSrc  = theadMatch ? theadMatch[0] : table;
  const headerRow  = headerSrc.match(/<tr[^>]*>([\s\S]*?)<\/tr>/i);
  if (!headerRow) throw new Error('헤더 행 없음');
  const headers = Array.from(headerRow[1].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi))
    .map(m => stripTags(m[1]));

  // 데이터: <tbody> 내 모든 <tr>, 없으면 전체 <tr> 목록
  const tbodyMatch = table.match(/<tbody[\s\S]*?<\/tbody>/i);
  const bodySrc    = tbodyMatch ? tbodyMatch[0] : table;
  const bodyRows   = Array.from(bodySrc.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi));
  const rows: string[][] = bodyRows
    .map(tr =>
      Array.from(tr[1].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi))
        .map(m => stripTags(m[1]))
    )
    .filter(r => r.length > 1);  // 단일 셀 행(병합 헤더 등) 제외

  return { headers, rows };
}

export async function collect(): Promise<CollectorResult> {
  const result: CollectorResult = { section: 'shipping', data: [] };

  let tableData: { headers: string[]; rows: string[][] };
  try {
    tableData = await rateLimited(SOURCE_URL, () => fetchTable());
  } catch (err) {
    const msg = (err as Error).message;
    console.warn(`⚠️ oneksa 수집 실패: ${msg}`);
    result.data.push({
      data_type: 'index', data_key: 'ONEKSA_error', data_value: {},
      source: 'oneksa.kr', source_url: SOURCE_URL,
      is_complete: false, error_message: msg,
    });
    return result;
  }

  const { headers, rows } = tableData;

  // 날짜 열 인덱스 (헤더 "날짜" 또는 첫 열)
  const dateIdx = Math.max(0, headers.findIndex(h => /날짜|date/i.test(h)));

  // 헤더와 DB 코드를 연결
  const colMap: Array<{ colIdx: number; dbCode: string }> = [];
  for (let i = 0; i < headers.length; i++) {
    const code = COL_MAP[headers[i]];
    if (code) colMap.push({ colIdx: i, dbCode: code });
  }

  if (colMap.length === 0) {
    const msg = `매핑된 컬럼 없음 — 실제 헤더: [${headers.join(', ')}]`;
    console.warn(`⚠️ oneksa: ${msg}`);
    result.data.push({
      data_type: 'index', data_key: 'ONEKSA_error', data_value: { headers },
      source: 'oneksa.kr', source_url: SOURCE_URL,
      is_complete: false, error_message: msg,
    });
    return result;
  }

  const dbRows: Record<string, unknown>[] = [];

  // 최근 8주 (약 2개월) 분량만 처리
  for (const row of rows.slice(0, 8)) {
    const rawDate = row[dateIdx]?.trim() ?? '';
    // YYYY-MM-DD 또는 YYYY.MM.DD 형식 허용
    const normDate = rawDate.replace(/\./g, '-');
    if (!/^\d{4}-\d{2}-\d{2}/.test(normDate)) continue;
    const weekDate = toMonday(normDate);

    for (const { colIdx, dbCode } of colMap) {
      const val = parseNum(row[colIdx] ?? '');
      if (val === null) continue;  // '-' 또는 누락 → 저장 안 함

      dbRows.push({
        index_code: dbCode,
        value:      val,
        week_date:  weekDate,
        change_pct: null,
        source:     'oneksa.kr',
        source_url: SOURCE_URL,
      });
      result.data.push({
        data_type:  'index',
        data_key:   `ONEKSA_${dbCode}_${normDate}`,
        data_value: { name: dbCode, value: val, date: normDate, source: 'oneksa.kr', source_url: SOURCE_URL },
        source: 'oneksa.kr', source_url: SOURCE_URL,
        is_complete: true,
      });
    }
  }

  const success = result.data.filter(d => d.is_complete).length;
  console.log(`✅ freight_index_excel (oneksa): ${success}건, DB upsert 예정 ${dbRows.length}행`);

  // freight_indices 테이블에 항로 코드 그대로 upsert (index_code+week_date unique)
  await dbUpsert('freight_indices', dbRows, 'index_code,week_date').catch(e =>
    console.warn('[freight_indices] oneksa persist 실패:', (e as Error).message)
  );

  return result;
}

if (require.main === module) {
  collect().then(r => snapshotWriter(r)).catch(console.error);
}
