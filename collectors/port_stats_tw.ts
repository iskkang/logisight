// collectors/port_stats_tw.ts
// 대만 컨테이너 물동량 수집기 — port_throughput 테이블에 저장(country='TW', port_code='TW_ALL').
// 소스: 臺灣港務公司(Taiwan International Ports Corporation) 統計 —— 國際商港 컨테이너 처리량
//       https://www.twport.com.tw/en/statistics/ChartContainer?a=132&format=json
//
// 주의 1: 월 행에 연도가 없다 ★★
//         응답은 2차원 배열이고 이렇게 생겼다(2026-08-15 실측):
//           [0]      ["Year","Grand Total","Import Container","Export Container"]
//           [1..9]   연간 2017 ~ 2025
//           [10..21] "Jan"…"Dec"  ← 직전 완전연도(2025)
//           [22..27] "Jan"…"Jun"  ← 당해연도(2026) 누적
//         월 이름만 보고 파싱하면 'Jan' 이 두 번 나와 한쪽이 덮인다.
//         「마지막 완전연도 12개월 + 당해연도 누적」으로 갈라야 한다.
//         검증: 앞 12개월 합계 13,546,117 = 2025 연간 값과 정확히 일치.
//              마지막 행 Jun 1,120,704.25 = 2026-06.
//
// 주의 2: 월별은 18개월치뿐이다 ★
//         2017~2024 는 연간 값만 있다. 36개월 백필이 불가능하고 상한이 18개월이다.
//         KR(33)·HK(36) 과 시작점이 다르다 —— 표에서 TW 앞쪽이 비는 것은 결측이 아니라
//         소스가 원래 없는 것이다.
//
// 주의 3: 값에 소수점이 있다 (1,120,704.25). numeric 으로 받는다. 정수 파싱하면 잘린다.
//
// 주의 4: 쓰지 말 것 —— data.gov.tw #8368 은 2017-07 에서 멈췄고,
//         ChartCargo?a=130 은 revenue ton(計費噸)이라 TEU 가 아니다.
//
// ■ 라이선스 (필수) ★
// 대만 정부자료개방授權條款(OGDL) v1.0 은 출처표시를 이행하지 않으면 이용 권리가
// 소급해서 무효가 된다. source·source_url 을 옵셔널로 만들거나 화면에서 빼지 말 것.

import * as path from 'path';
import * as dotenv from 'dotenv';

import { dbUpsert } from './utils/supabase_writer';
import type { CollectorResult } from './types';

dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

const API = 'https://www.twport.com.tw/en/statistics/ChartContainer?a=132&format=json';
const SOURCE = '臺灣港務公司 (Taiwan International Ports Corporation)';
const SOURCE_URL = 'https://www.twport.com.tw/en/statistics/ChartContainer?a=132';
const UA = 'Mozilla/5.0 (compatible; Logisight/1.0)';

const MONTHS: Record<string, number> = {
  Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6,
  Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12,
};

export interface TwPortRow {
  port_code: 'TW_ALL';
  country: 'TW';
  year: number;
  month: number;
  teu: number;
  /** 이 소스의 Import/Export 는 수출입 컨테이너 구분이다. 그대로 담는다. */
  export_teu: number | null;
  import_teu: number | null;
  yoy_pct: null;
  is_preliminary: false;
  source: string;
  source_url: string;
}

/** 응답에서 연간 행(4자리 연도)만 골라 연도 오름차순으로 돌려준다. */
export function annualYears(rows: string[][]): number[] {
  return rows
    .filter((r) => /^\d{4}$/.test(String(r[0]).trim()))
    .map((r) => Number(r[0]))
    .sort((a, b) => a - b);
}

/**
 * 월 행에 연도를 붙인다.
 *
 * 규칙: 앞에서부터 12개는 「직전 완전연도」, 그 뒤는 「당해연도」.
 *       직전 완전연도 = 연간 행의 마지막 연도.
 * 월 행이 12개 이하면 전부 직전 완전연도로 본다(당해연도 누적이 아직 없는 시기).
 */
export function parseMonthlyRows(rows: string[][]): TwPortRow[] {
  const years = annualYears(rows);
  if (years.length === 0) throw new Error('연간 행이 없다 — 응답 구조가 바뀌었을 수 있다');
  const lastFullYear = years[years.length - 1];

  const monthRows = rows.filter((r) => MONTHS[String(r[0]).trim()] !== undefined);
  const out: TwPortRow[] = [];

  monthRows.forEach((r, i) => {
    const month = MONTHS[String(r[0]).trim()];
    const year = i < 12 ? lastFullYear : lastFullYear + 1;
    const teu = Number(r[1]);
    if (!Number.isFinite(teu)) return; // 결측을 0으로 채우지 않는다

    const imp = Number(r[2]);
    const exp = Number(r[3]);
    out.push({
      port_code: 'TW_ALL',
      country: 'TW',
      year,
      month,
      teu: Math.round(teu), // 소수점(.25)은 적재 시 반올림. 원값은 소수라 정수 파싱 금지
      export_teu: Number.isFinite(exp) ? Math.round(exp) : null,
      import_teu: Number.isFinite(imp) ? Math.round(imp) : null,
      yoy_pct: null,
      is_preliminary: false,
      source: SOURCE,
      source_url: SOURCE_URL,
    });
  });

  return out;
}

/**
 * 갈라낸 결과가 연간 값과 맞는지 확인한다.
 * 직전 완전연도의 12개월 합계가 그 해 연간 값과 다르면 연도 배정이 틀린 것이다.
 * 허용 오차는 반올림 누적분(12개월 × 0.5).
 */
export function verifyAgainstAnnual(rows: string[][], parsed: TwPortRow[]): void {
  const years = annualYears(rows);
  const lastFullYear = years[years.length - 1];
  const annualRow = rows.find((r) => Number(r[0]) === lastFullYear);
  if (!annualRow) return;

  const months = parsed.filter((p) => p.year === lastFullYear);
  if (months.length !== 12) return; // 아직 다 안 찬 해는 대조하지 않는다

  const sum = months.reduce((a, p) => a + p.teu, 0);
  const annual = Number(annualRow[1]);
  if (!Number.isFinite(annual)) return;
  if (Math.abs(sum - annual) > 6) {
    throw new Error(`연도 배정 검증 실패: ${lastFullYear} 월 합계 ${sum} ≠ 연간 ${annual}`);
  }
}

export async function collect(): Promise<CollectorResult> {
  const result: CollectorResult = { section: 'shipping', data: [] };
  try {
    const res = await fetch(API, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const rows = (await res.json()) as string[][];
    if (!Array.isArray(rows) || rows.length === 0) throw new Error('빈 응답');

    const parsed = parseMonthlyRows(rows);
    if (parsed.length === 0) throw new Error('월 행을 하나도 못 읽었다');
    verifyAgainstAnnual(rows, parsed);

    const sorted = parsed.sort((a, b) => a.year * 12 + a.month - (b.year * 12 + b.month));
    const latest = sorted[sorted.length - 1];

    if (process.argv.includes('--dry-run')) {
      console.log(`[dry-run] ${sorted.length}건 · ${sorted[0].year}-${String(sorted[0].month).padStart(2, '0')} ~ ${latest.year}-${String(latest.month).padStart(2, '0')} · 최신 ${latest.teu.toLocaleString()} TEU`);
      return result;
    }

    await dbUpsert('port_throughput', sorted as unknown as Record<string, unknown>[], 'port_code,year,month');
    console.log(`✅ 대만 항만: ${sorted.length}건 저장 (최신 ${latest.year}-${String(latest.month).padStart(2, '0')})`);
    result.data.push({
      data_type: 'port_stat', data_key: 'PORT_TW_TIPC',
      data_value: { count: sorted.length, latest: `${latest.year}-${latest.month}` },
      source: SOURCE, source_url: SOURCE_URL, is_complete: true,
    });
  } catch (e) {
    console.warn(`⚠️ 대만 항만 수집 실패: ${(e as Error).message}`);
    result.data.push({
      data_type: 'port_stat', data_key: 'PORT_TW_TIPC_error', data_value: {},
      source: SOURCE, source_url: SOURCE_URL, is_complete: false,
      error_message: (e as Error).message,
    });
  }
  return result;
}

if (require.main === module) {
  collect().catch(console.error);
}
