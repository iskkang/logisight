// collectors/trade_commodity_jp.ts
// 일본 품목별·국가별 수출입 수집기 — jp_trade_by_commodity 테이블에 적재.
// 소스: 財務省貿易統計 概況品別国別表 (e-Stat DB, getStatsData API)
//
// trade_stats_jp.ts(국가별 총액)의 품목 축이다. 국가 축이 "대중 수출 X%"를 준다면
// 이쪽은 "대중 기계류 수출 X%"를 준다.
//
// 차원이 크다 — 品目 404 × 국가 222 × 27(월별 수량·금액). 전량은 240만 셀이라
// 두 가지로 좁힌다:
//   1. 최상위 10개 품목만 (SITC 계열 대분류). 하위는 필요해지면 그때 넓힌다
//   2. 金額만. 数量은 단위가 품목마다 달라(kg·리터·개) 한 컬럼에 섞으면 합산이 무의미하다
// 그러면 한 방향당 약 1.9만 건으로 API 한 번에 들어온다.
//
// 표가 연 단위로 나뉜다(statsDataId가 연도별). time 차원에는 해당 연도 하나뿐이고
// 월은 cat02 코드에 들어 있다.

import * as path from 'path';
import * as dotenv from 'dotenv';

import { rateLimited } from './utils/rate_limiter';
import { dbUpsert } from './utils/supabase_writer';
import type { CollectorResult } from './types';

// 단독 실행 시에는 index.ts를 거치지 않아 env가 비어 있다.
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

const API = 'https://api.e-stat.go.jp/rest/3.0/app/json';
const STATS_CODE = '00350300';
const SEARCH_WORD = '概況品別国別';
const SOURCE = '財務省貿易統計 概況品別国別表';
const SOURCE_URL = 'https://www.customs.go.jp/toukei/info/tsdl.htm';
const UNIT = 'thousand_jpy';

/** 概況品目 대분류 10개. 명칭이 한 자리 숫자로 시작하는 계층이다. */
export const TOP_COMMODITIES = [
  '00000000', '10000000', '20000000', '30000000', '40000000',
  '50000000', '60000000', '70000000', '80000000', '90000000',
];

/** 월별 금액 코드 = 120 + 월×20 (1月_金額=140 … 12月_金額=360). */
const MONTH_VALUE_CODES = Array.from({ length: 12 }, (_, i) => String(120 + (i + 1) * 20));

export interface EstatValue {
  '@cat01': string;
  '@cat02': string;
  '@area': string;
  $: string;
}

export interface CommodityRow {
  direction: string;
  commodity_code: string;
  commodity_name: string;
  country_code: string;
  country_name: string;
  year: number;
  month: number;
  value_jpy: number;
  unit: string;
  source: string;
  source_url: string;
}

export function monthFromCat02(code: string): number | null {
  const n = Number(String(code || '').trim());
  if (!Number.isFinite(n)) return null;
  const month = (n - 120) / 20;
  if (!Number.isInteger(month) || month < 1 || month > 12) return null;
  return month;
}

/** 메타 명칭은 '0_食料品及び動物', '103_大韓民国'처럼 코드가 앞에 붙어 나온다. */
export function stripCodePrefix(name: string): string {
  return String(name || '').replace(/^[0-9]+_/, '');
}

export function buildCommodityRows(
  values: EstatValue[],
  ctx: {
    year: number;
    direction: string;
    commodity: Record<string, string>;
    country: Record<string, string>;
  },
): CommodityRow[] {
  const rows: CommodityRow[] = [];
  for (const v of values) {
    const month = monthFromCat02(v['@cat02']);
    if (month === null) continue; // 数量·合計·単位 코드
    const commodityName = ctx.commodity[v['@cat01']];
    const countryName = ctx.country[v['@area']];
    // 이름을 모르면 정체불명 행이 된다. 넣지 않는다.
    if (!commodityName || !countryName) continue;
    const value = Number(String(v.$).replace(/,/g, ''));
    if (!Number.isFinite(value)) continue; // '-' 등 비공표
    rows.push({
      direction: ctx.direction,
      commodity_code: v['@cat01'],
      commodity_name: stripCodePrefix(commodityName),
      country_code: v['@area'],
      country_name: stripCodePrefix(countryName),
      year: ctx.year,
      month,
      value_jpy: value,
      unit: UNIT,
      source: SOURCE,
      source_url: SOURCE_URL,
    });
  }
  return rows;
}

/**
 * 아직 공표되지 않은 달을 버린다.
 * 표가 연 단위라 미공표 월의 셀이 0으로 채워져 반환된다(2026년 표의 7~12월).
 * 그대로 적재하면 사이트에 "12월 수출 0엔"이 표시된다.
 * 한 달 전체에 0이 아닌 값이 하나도 없으면 미공표로 본다 — 공표된 달의 0은 남긴다.
 */
export function dropUnreportedMonths(rows: CommodityRow[]): CommodityRow[] {
  const reported = new Set<string>();
  for (const r of rows) {
    if (r.value_jpy !== 0) reported.add(`${r.direction}_${r.year}_${r.month}`);
  }
  return rows.filter((r) => reported.has(`${r.direction}_${r.year}_${r.month}`));
}

async function getJson(url: string): Promise<any> {
  const res = await fetch(url, { signal: AbortSignal.timeout(90000) });
  if (!res.ok) throw new Error(`e-Stat HTTP ${res.status}`);
  return res.json();
}

/** 카탈로그에서 최신 회차의 輸出·輸入 DB 테이블 id를 찾는다. */
async function findLatestTables(appId: string): Promise<{ year: number; tables: { direction: string; id: string }[] }> {
  const json = await getJson(
    `${API}/getDataCatalog?appId=${appId}&statsCode=${STATS_CODE}&limit=100&searchWord=${encodeURIComponent(SEARCH_WORD)}`,
  );
  if (json?.GET_DATA_CATALOG?.RESULT?.STATUS !== 0) {
    throw new Error(`카탈로그 오류: ${json?.GET_DATA_CATALOG?.RESULT?.ERROR_MSG}`);
  }
  const list = ([] as any[]).concat(json.GET_DATA_CATALOG.DATA_CATALOG_LIST_INF?.DATA_CATALOG_INF ?? []);

  const monthly = list
    .filter((d) => d.DATASET?.TITLE?.CYCLE === '月次')
    .map((d) => {
      const name = String(d.DATASET.TITLE.NAME ?? '');
      const db = ([] as any[]).concat(d.RESOURCES?.RESOURCE ?? []).find((r) => r.FORMAT === 'DB');
      return {
        surveyDate: Number(d.DATASET.TITLE.SURVEY_DATE) || 0,
        direction: /輸出/.test(name) ? 'export' : /輸入/.test(name) ? 'import' : null,
        id: db?.URL ? String(db.URL) : null,
      };
    })
    .filter((d) => d.direction && d.id) as { surveyDate: number; direction: string; id: string }[];

  if (monthly.length === 0) throw new Error('DB 리소스가 있는 월차 표 없음');

  const latest = Math.max(...monthly.map((m) => m.surveyDate));
  const year = Math.floor(latest / 100);
  // 같은 연도 표는 방향별로 하나씩이다.
  const tables = ['export', 'import']
    .map((direction) => {
      const found = monthly.filter((m) => m.direction === direction).sort((a, b) => b.surveyDate - a.surveyDate)[0];
      return found ? { direction, id: found.id } : null;
    })
    .filter(Boolean) as { direction: string; id: string }[];

  return { year, tables };
}

async function fetchNames(appId: string, statsDataId: string): Promise<{ commodity: Record<string, string>; country: Record<string, string> }> {
  const json = await getJson(`${API}/getMetaInfo?appId=${appId}&statsDataId=${statsDataId}`);
  const objs = ([] as any[]).concat(json?.GET_META_INFO?.METADATA_INF?.CLASS_INF?.CLASS_OBJ ?? []);
  const toMap = (id: string) => {
    const map: Record<string, string> = {};
    for (const c of ([] as any[]).concat(objs.find((o) => o['@id'] === id)?.CLASS ?? [])) {
      map[String(c['@code'])] = String(c['@name']);
    }
    return map;
  };
  return { commodity: toMap('cat01'), country: toMap('area') };
}

async function fetchValues(appId: string, statsDataId: string): Promise<EstatValue[]> {
  const url =
    `${API}/getStatsData?appId=${appId}&statsDataId=${statsDataId}`
    + `&cdCat01=${TOP_COMMODITIES.join(',')}`
    + `&cdCat02=${MONTH_VALUE_CODES.join(',')}`
    + `&limit=100000`;
  const json = await getJson(url);
  if (json?.GET_STATS_DATA?.RESULT?.STATUS !== 0) {
    throw new Error(`데이터 오류: ${json?.GET_STATS_DATA?.RESULT?.ERROR_MSG}`);
  }
  return ([] as EstatValue[]).concat(json.GET_STATS_DATA.STATISTICAL_DATA?.DATA_INF?.VALUE ?? []);
}

export async function collect(): Promise<CollectorResult> {
  const result: CollectorResult = { section: 'trade', data: [] };
  const appId = process.env.ESTAT_APP_ID;

  if (!appId) {
    console.warn('⚠️ ESTAT_APP_ID 미설정 — 일본 품목별 무역통계 건너뜀');
    result.data.push({
      data_type: 'trade_stat', data_key: 'TRADE_JP_COMMODITY_error', data_value: {},
      source: SOURCE, source_url: SOURCE_URL, is_complete: false,
      error_message: 'ESTAT_APP_ID 미설정',
    });
    return result;
  }

  try {
    const { year, tables } = await rateLimited('概況品別国別 카탈로그', () => findLatestTables(appId));

    const raw: CommodityRow[] = [];
    for (const { direction, id } of tables) {
      const names = await rateLimited(`메타 ${direction}`, () => fetchNames(appId, id));
      const values = await rateLimited(`데이터 ${direction}`, () => fetchValues(appId, id));
      raw.push(...buildCommodityRows(values, { year, direction, ...names }));
    }

    const rows = dropUnreportedMonths(raw);
    if (raw.length !== rows.length) {
      console.warn(`⚠️ 미공표 월 제외: ${raw.length - rows.length}건`);
    }
    if (rows.length === 0) throw new Error('적재할 행 없음 — 표 구성 변경 의심');

    await dbUpsert(
      'jp_trade_by_commodity',
      rows as unknown as Record<string, unknown>[],
      'direction,commodity_code,country_code,year,month',
    );

    const latestMonth = Math.max(...rows.map((r) => r.month));
    console.log(
      `✅ 일본 품목별 무역: ${rows.length}건 저장 (${year}년, 최신 ${latestMonth}월, `
      + `품목 ${new Set(rows.map((r) => r.commodity_code)).size}개 × 국가 ${new Set(rows.map((r) => r.country_code)).size}개)`,
    );
    result.data.push({
      data_type: 'trade_stat', data_key: 'TRADE_JP_COMMODITY',
      data_value: { count: rows.length, year, latestMonth, directions: tables.length },
      source: SOURCE, source_url: SOURCE_URL, is_complete: true,
    });
  } catch (e) {
    console.warn(`⚠️ 일본 품목별 무역 실패: ${(e as Error).message}`);
    result.data.push({
      data_type: 'trade_stat', data_key: 'TRADE_JP_COMMODITY_error', data_value: {},
      source: SOURCE, source_url: SOURCE_URL, is_complete: false,
      error_message: (e as Error).message,
    });
  }

  return result;
}

if (require.main === module) {
  collect().catch(console.error);
}
