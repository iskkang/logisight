// collectors/trade_stats_jp.ts
// 일본 국가별 수출입 통계 수집기 — jp_trade_stats 테이블에 적재.
// 소스: 財務省貿易統計 / e-Stat 파일 카탈로그 (statsCode=00350300)
//       貿易統計_貿易概況_地域(国)別輸出入時系列表_月次
//
// 일본 통계 중 지연이 가장 짧다(약 1.5개월). 월간 리포트의 시의성은 여기서 나온다.
//
// 파일 구조: 한 회차가 지역별 CSV 9개로 쪼개져 있다. 헤더가 영문이라 인코딩 문제는 없다.
//   0행: Year & Month, Grand Total, , ASIA, , R KOREA, , CHINA, ...  (국가마다 2열 병합)
//   1행: , Exports, Imports, Exports, Imports, ...
//   이후: 연차 / 회계연도 / 분기 / 월차 13개월 / (Ratio to SM)
// 금액 단위는 千円이다(2025년 수출 총액 110,400,454,682 = 110.4조엔).

import * as path from 'path';
import * as dotenv from 'dotenv';

import { rateLimited } from './utils/rate_limiter';
import { dbUpsert } from './utils/supabase_writer';
import type { CollectorResult } from './types';

// 단독 실행 시에는 index.ts를 거치지 않아 env가 비어 있다.
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

const CATALOG = 'https://api.e-stat.go.jp/rest/3.0/app/json/getDataCatalog';
const STATS_CODE = '00350300';
const SEARCH_WORD = '地域国別';
const SOURCE = '財務省貿易統計';
const SOURCE_URL = 'https://www.customs.go.jp/toukei/info/tsdl.htm';
const UNIT = 'thousand_jpy';

/**
 * 위치 규칙(파일당 [0]=Grand Total, [1]=지역 합계)만으로는 하위 집계를 놓친다.
 * ASIA 파일 안에 ASIA NIES·ASEAN이, WESTERN EUROPE 파일 안에 EU가 별도 열로 들어 있어
 * 국가로 잡히면 수출 상위 목록에서 USA·CHINA와 나란히 비교된다(모집단이 다르다).
 */
const SUB_AGGREGATES = new Set(['ASIA NIES', 'ASEAN', 'EU']);

const MONTHS: Record<string, number> = {
  Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6,
  Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12,
};

export interface TradeRow {
  country_name: string;
  region: string | null;
  is_aggregate: boolean;
  year: number;
  month: number;
  export_jpy: number | null;
  import_jpy: number | null;
  yoy_export_pct: number | null;
  yoy_import_pct: number | null;
  unit: string;
  source: string;
  source_url: string;
}

/**
 * '2026 Jun.' 만 월차로 인정한다.
 * 같은 열에 '2025 Apr.-Jun.'(분기)·'2023 (FY)'(회계연도)·'(Ratio to PY)'가 섞여 있어,
 * 느슨하게 매칭하면 분기 합계가 한 달치로 들어가 수치가 3배로 부풀려진다.
 */
export function parseTradePeriod(label: string): { year: number; month: number } | null {
  const m = /^(\d{4})\s+([A-Z][a-z]{2})\.$/.exec(String(label || '').trim());
  if (!m) return null;
  const month = MONTHS[m[2]];
  if (!month) return null;
  return { year: Number(m[1]), month };
}

function num(value: string | undefined): number | null {
  const raw = String(value ?? '').replace(/,/g, '').trim();
  if (!raw || raw === '-') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** 지수 표기(119.3)를 증감률(+19.3)로. 港湾速報와 같은 함정이다. */
function ratioToPct(value: string | undefined): number | null {
  const n = num(value);
  return n === null ? null : n - 100;
}

export function parseTradeCsv(csvText: string): TradeRow[] {
  const lines = csvText.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 3) return [];

  const head = lines[0].split(',');
  // 국가는 1,3,5,… 열에 이름이 오고 다음 열은 비어 있다(수출/수입 병합).
  const columns: { name: string; idx: number }[] = [];
  for (let i = 1; i < head.length; i += 2) {
    const name = head[i]?.trim();
    if (name) columns.push({ name, idx: i });
  }
  if (columns.length === 0) return [];

  // 파일마다 [0]=Grand Total(세계), [1]=그 파일의 지역 합계, 이후가 소속 국가다.
  const region = columns.length > 1 ? columns[1].name : null;

  const rows: TradeRow[] = [];
  const monthlyByPeriod: { period: { year: number; month: number }; cells: string[] }[] = [];
  let ratioCells: string[] | null = null;

  for (const line of lines.slice(2)) {
    const cells = line.split(',');
    const label = cells[0]?.trim() ?? '';
    if (label === '(Ratio to SM)') { ratioCells = cells; continue; }
    const period = parseTradePeriod(label);
    if (period) monthlyByPeriod.push({ period, cells });
  }
  if (monthlyByPeriod.length === 0) return [];

  // (Ratio to SM)은 가장 최근 월에 대한 전년동월비다. 다른 달에 임의로 붙이지 않는다.
  const latestKey = monthlyByPeriod
    .map((m) => m.period.year * 12 + m.period.month)
    .reduce((a, b) => Math.max(a, b), 0);

  for (const { period, cells } of monthlyByPeriod) {
    const isLatest = period.year * 12 + period.month === latestKey;
    for (let c = 0; c < columns.length; c += 1) {
      const { name, idx } = columns[c];
      rows.push({
        country_name: name,
        region: c === 0 ? null : region,
        is_aggregate: c <= 1 || SUB_AGGREGATES.has(name.trim().toUpperCase()),
        year: period.year,
        month: period.month,
        export_jpy: num(cells[idx]),
        import_jpy: num(cells[idx + 1]),
        yoy_export_pct: isLatest && ratioCells ? ratioToPct(ratioCells[idx]) : null,
        yoy_import_pct: isLatest && ratioCells ? ratioToPct(ratioCells[idx + 1]) : null,
        unit: UNIT,
        source: SOURCE,
        source_url: SOURCE_URL,
      });
    }
  }
  return rows;
}

/**
 * 같은 국가·연월 행을 하나로 줄인다.
 * 한 회차가 지역별 CSV 9개로 쪼개져 있는데 'Grand Total'이 9개 파일 모두에 들어 있다.
 * 그대로 upsert하면 Postgres가 거부한다:
 *   ON CONFLICT DO UPDATE command cannot affect row a second time
 */
export function dedupeTradeRows(rows: TradeRow[]): TradeRow[] {
  const seen = new Set<string>();
  const out: TradeRow[] = [];
  for (const r of rows) {
    const key = `${r.country_name}_${r.year}_${r.month}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

async function fetchLatestResources(appId: string): Promise<{ period: string; urls: string[] }> {
  const url = `${CATALOG}?appId=${appId}&statsCode=${STATS_CODE}&limit=100&searchWord=${encodeURIComponent(SEARCH_WORD)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error(`e-Stat 카탈로그 HTTP ${res.status}`);
  const json = await res.json();
  if (json?.GET_DATA_CATALOG?.RESULT?.STATUS !== 0) {
    throw new Error(`e-Stat 카탈로그 오류: ${json?.GET_DATA_CATALOG?.RESULT?.ERROR_MSG}`);
  }
  const list = ([] as any[]).concat(json.GET_DATA_CATALOG.DATA_CATALOG_LIST_INF?.DATA_CATALOG_INF ?? []);

  const candidates = list
    .filter((d) => {
      const t = d.DATASET?.TITLE ?? {};
      return t.CYCLE === '月次' && /時系列表/.test(String(t.NAME ?? ''));
    })
    .map((d) => ({
      surveyDate: Number(d.DATASET.TITLE.SURVEY_DATE) || 0,
      urls: ([] as any[]).concat(d.RESOURCES?.RESOURCE ?? [])
        .filter((r) => r.FORMAT === 'CSV' && r.URL)
        .map((r) => String(r.URL)),
    }))
    .filter((c) => c.urls.length > 0)
    .sort((a, b) => b.surveyDate - a.surveyDate);

  if (candidates.length === 0) throw new Error('월차 시계열표 없음 — 카탈로그 구성 변경 의심');
  return { period: String(candidates[0].surveyDate), urls: candidates[0].urls };
}

async function fetchCsv(url: string): Promise<string> {
  const res = await fetch(url, { signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error(`CSV HTTP ${res.status}`);
  // 이 표는 헤더·국가명이 영문이라 UTF-8로 읽어도 깨지지 않는다.
  return Buffer.from(await res.arrayBuffer()).toString('utf8');
}

export async function collect(): Promise<CollectorResult> {
  const result: CollectorResult = { section: 'trade', data: [] };
  const appId = process.env.ESTAT_APP_ID;

  if (!appId) {
    console.warn('⚠️ ESTAT_APP_ID 미설정 — 일본 무역통계 건너뜀');
    result.data.push({
      data_type: 'trade_stat', data_key: 'TRADE_JP_error', data_value: {},
      source: SOURCE, source_url: SOURCE_URL, is_complete: false,
      error_message: 'ESTAT_APP_ID 미설정',
    });
    return result;
  }

  try {
    const { period, urls } = await rateLimited('財務省貿易統計 카탈로그', () => fetchLatestResources(appId));

    const raw: TradeRow[] = [];
    const failed: string[] = [];
    for (const [i, url] of urls.entries()) {
      try {
        const csv = await rateLimited(`貿易統計 파일${i + 1}`, () => fetchCsv(url));
        const parsed = parseTradeCsv(csv);
        if (parsed.length === 0) failed.push(`파일${i + 1}(파싱 0건)`);
        raw.push(...parsed);
      } catch (e) {
        // 지역 파일 하나가 깨져도 나머지는 살린다.
        failed.push(`파일${i + 1}(${(e as Error).message})`);
      }
    }

    if (failed.length > 0) console.warn(`⚠️ ${failed.length}개 파일 실패: ${failed.slice(0, 4).join(', ')}`);
    const rows = dedupeTradeRows(raw);
    if (rows.length === 0) throw new Error('적재할 행 없음');

    await dbUpsert(
      'jp_trade_stats',
      rows as unknown as Record<string, unknown>[],
      'country_name,year,month',
    );

    const latest = rows.reduce((a, b) => (a.year * 12 + a.month >= b.year * 12 + b.month ? a : b));
    const world = rows.find(
      (r) => r.country_name === 'Grand Total' && r.year === latest.year && r.month === latest.month,
    );
    const countries = new Set(rows.filter((r) => !r.is_aggregate).map((r) => r.country_name)).size;
    console.log(
      `✅ 일본 무역통계: ${rows.length}건 저장 (최신 ${latest.year}-${String(latest.month).padStart(2, '0')}, `
      + `국가 ${countries}개${world?.export_jpy ? `, 수출 총액 ${(world.export_jpy / 1e9).toFixed(1)}조엔` : ''})`,
    );
    result.data.push({
      data_type: 'trade_stat', data_key: 'TRADE_JP',
      data_value: { count: rows.length, countries, period, files: urls.length, failed: failed.length },
      source: SOURCE, source_url: SOURCE_URL, is_complete: true,
    });
  } catch (e) {
    console.warn(`⚠️ 일본 무역통계 실패: ${(e as Error).message}`);
    result.data.push({
      data_type: 'trade_stat', data_key: 'TRADE_JP_error', data_value: {},
      source: SOURCE, source_url: SOURCE_URL, is_complete: false,
      error_message: (e as Error).message,
    });
  }

  return result;
}

if (require.main === module) {
  collect().catch(console.error);
}
