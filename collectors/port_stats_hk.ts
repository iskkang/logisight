// collectors/port_stats_hk.ts
// 홍콩 컨테이너 물동량 수집기 — port_throughput 테이블에 저장(country='HK', port_code='HK_ALL').
// 소스: 홍콩 해사처(Hong Kong Maritime and Port Board) 컨테이너 처리량 통계 CSV
//       https://www.hkmpb.gov.hk/document/HKP_KTCT-stat_csv1(EN).csv
//
// 주의 1: 단위가 '000 TEUs 다 ★
//         Total 열의 1,061 은 106만 TEU 다. 그대로 넣으면 1000배 축소된다.
//         2026-08-15 실측: 2026-06 Total = 1061 → 1,061,000 TEU.
//
// 주의 2: 연간 행이 월간 행과 같은 파일에 섞여 있다 ★
//         month 열이 'All' 인 행이 2009~2025 연간 합계다(17건). 월 이름('Jan'…'Dec')이
//         아닌 행은 전부 버린다. 안 버리면 한 해 물동량이 한 달로 적재된다.
//
// 주의 3: 추정치 마킹이 없다 ★
//         홍콩은 최근 월을 나중에 상향/하향 정정하는데 CSV 에 그 표시가 없다.
//         가장 최근 PRELIMINARY_MONTHS 개월을 수집기가 직접 is_preliminary=true 로 찍는다.
//         근거가 아니라 운영 규칙이라, 바꾸려면 이 상수만 고치면 된다.
//
// 참고: 같은 사이트의 csv2 는 葵青(Kwai Tsing) 터미널의 적/공 컨테이너 상세다.
//       국가 단위 표에는 필요 없어 지금은 쓰지 않는다. 필요해지면 같은 방식으로 붙인다.
//
// 라이선스: 홍콩 정부 공개자료. 출처 표기를 유지할 것(source·source_url 컬럼).

import * as path from 'path';
import * as dotenv from 'dotenv';

import { dbUpsert } from './utils/supabase_writer';
import type { CollectorResult } from './types';

dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

const CSV_URL = "https://www.hkmpb.gov.hk/document/HKP_KTCT-stat_csv1(EN).csv";
const SOURCE = 'Hong Kong Maritime and Port Board';
const SOURCE_URL = 'https://www.hkmpb.gov.hk/en/statistics.html';

/** 최근 이 개월 수는 잠정치로 본다(홍콩 CSV 에 정정 표시가 없다). */
export const PRELIMINARY_MONTHS = 2;

const MONTHS: Record<string, number> = {
  Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6,
  Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12,
};

export interface HkPortRow {
  port_code: 'HK_ALL';
  country: 'HK';
  year: number;
  month: number;
  /** 단위 환산 완료 — CSV 의 '000 TEUs 를 TEU 로 올린 값. */
  teu: number;
  export_teu: null;
  import_teu: null;
  yoy_pct: number | null;
  is_preliminary: boolean;
  source: string;
  source_url: string;
}

/**
 * CSV → 월간 행. 연간('All') 행과 숫자로 못 읽는 행은 버린다.
 * 열: Year, month, KwaiTsing, Other, Total, KT YoY%, Other YoY%, Total YoY%
 */
export function parseCsv(csv: string): HkPortRow[] {
  const out: HkPortRow[] = [];
  const lines = csv.split(/\r?\n/).slice(1); // 헤더 버림
  for (const line of lines) {
    if (!line.trim()) continue;
    const c = line.split(',');
    if (c.length < 8) continue;

    const month = MONTHS[c[1]?.trim()];
    if (!month) continue; // 'All' 연간 행 등

    const year = Number(c[0]);
    const thousandTeu = Number(c[4]);
    if (!Number.isInteger(year) || !Number.isFinite(thousandTeu)) continue;

    const yoy = Number(c[7]);
    out.push({
      port_code: 'HK_ALL',
      country: 'HK',
      year,
      month,
      teu: Math.round(thousandTeu * 1000), // ★ '000 TEUs → TEU
      export_teu: null,
      import_teu: null,
      yoy_pct: Number.isFinite(yoy) ? yoy : null,
      is_preliminary: false, // markPreliminary 가 최신 몇 달만 뒤집는다
      source: SOURCE,
      source_url: SOURCE_URL,
    });
  }
  return out;
}

/** 연월 오름차순 정렬 후 마지막 n개월을 잠정치로 표시한다. */
export function markPreliminary(rows: HkPortRow[], n = PRELIMINARY_MONTHS): HkPortRow[] {
  const sorted = [...rows].sort((a, b) => a.year * 12 + a.month - (b.year * 12 + b.month));
  const cutoff = sorted.length - n;
  return sorted.map((r, i) => ({ ...r, is_preliminary: i >= cutoff }));
}

/** 최근 months 개월만 남긴다(백필 목표와 동일한 창). */
export function recentMonths(rows: HkPortRow[], months: number): HkPortRow[] {
  const sorted = [...rows].sort((a, b) => a.year * 12 + a.month - (b.year * 12 + b.month));
  return months > 0 ? sorted.slice(-months) : sorted;
}

export async function collect(): Promise<CollectorResult> {
  const result: CollectorResult = { section: 'shipping', data: [] };
  try {
    const res = await fetch(CSV_URL, { signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const csv = await res.text();

    const all = parseCsv(csv);
    if (all.length === 0) throw new Error('월간 행을 하나도 못 읽었다 — CSV 형식이 바뀌었을 수 있다');

    const monthsArg = process.argv.find((a) => a.startsWith('--months='))?.split('=')[1];
    const window = monthsArg ? Number(monthsArg) : 36;
    const rows = markPreliminary(recentMonths(all, window));

    const latest = rows[rows.length - 1];
    if (process.argv.includes('--dry-run')) {
      console.log(`[dry-run] ${rows.length}건 · 최신 ${latest.year}-${String(latest.month).padStart(2, '0')} ${latest.teu.toLocaleString()} TEU (잠정 ${PRELIMINARY_MONTHS}개월)`);
      return result;
    }

    await dbUpsert('port_throughput', rows as unknown as Record<string, unknown>[], 'port_code,year,month');
    console.log(`✅ 홍콩 항만: ${rows.length}건 저장 (최신 ${latest.year}-${String(latest.month).padStart(2, '0')})`);
    result.data.push({
      data_type: 'port_stat', data_key: 'PORT_HK_HKMPB',
      data_value: { count: rows.length, latest: `${latest.year}-${latest.month}`, preliminary: PRELIMINARY_MONTHS },
      source: SOURCE, source_url: SOURCE_URL, is_complete: true,
    });
  } catch (e) {
    console.warn(`⚠️ 홍콩 항만 수집 실패: ${(e as Error).message}`);
    result.data.push({
      data_type: 'port_stat', data_key: 'PORT_HK_HKMPB_error', data_value: {},
      source: SOURCE, source_url: SOURCE_URL, is_complete: false,
      error_message: (e as Error).message,
    });
  }
  return result;
}

if (require.main === module) {
  collect().catch(console.error);
}
