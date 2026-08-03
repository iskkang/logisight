// collectors/port_prelim_jp.ts
// 일본 주요 6항 컨테이너 속보 수집기 — port_throughput에 is_preliminary=true로 적재.
// 소스: 国土交通省 港湾統計（速報） / e-Stat 파일 카탈로그 (statsCode=00600280)
//
// 확보(確報, port_stats_jp.ts)는 지연이 커서 주요 항만이 다 채워진 마지막 달이
// 2025-07이다. 속보는 2026-05까지 나와 있어 10개월 앞선다. 뉴스로 쓸 수 있는
// 최신 수치는 이쪽이다.
//
// 실행 순서 주의: 같은 달을 둘 다 다루면 확보가 이겨야 한다.
// 워크플로에서는 이 수집기를 먼저, port_stats_jp를 나중에 돌린다.

import * as path from 'path';
import * as XLSX from 'xlsx';
import * as dotenv from 'dotenv';

import { rateLimited } from './utils/rate_limiter';
import { dbUpsert } from './utils/supabase_writer';
import type { CollectorResult } from './types';

// 단독 실행 시에는 index.ts를 거치지 않아 env가 비어 있다.
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

const CATALOG = 'https://api.e-stat.go.jp/rest/3.0/app/json/getDataCatalog';
const STATS_CODE = '00600280';
const SOURCE = '国土交通省 港湾統計（速報）';
const SOURCE_URL = 'https://www.mlit.go.jp/k-toukei/kouwan.html';

/** 최근 몇 개월치를 적재할지. 확보가 약 12개월 지연이라 그 구간을 덮을 만큼만 가져온다. */
const RECENT_MONTHS = 18;

/**
 * 시트의 '合計'는 全国이 아니라 主要6港 합계다.
 * 확보의 全国(JP_ALL)과 같은 코드를 쓰면 서로 다른 모집단이 한 계열로 섞인다.
 */
export const PRELIM_PORTS: Record<string, string> = {
  '合計': 'JP_MAJOR6',
  '東京港': 'JPTYO',
  '川崎港': 'JPKWS',
  '横浜港': 'JPYOK',
  '名古屋港': 'JPNGO',
  '大阪港': 'JPOSA',
  '神戸港': 'JPUKB',
};

export interface PrelimRow {
  port_code: string;
  country: string;
  year: number;
  month: number;
  teu: number;
  export_teu: number | null;
  import_teu: number | null;
  yoy_pct: number | null;
  is_preliminary: boolean;
  source: string;
  source_url: string;
}

export function parsePeriodFromTitle(title: string): { year: number; month: number } | null {
  const m = /(\d{4})年(\d{1,2})月/.exec(String(title || ''));
  if (!m) return null;
  const month = Number(m[2]);
  if (!(month >= 1 && month <= 12)) return null;
  return { year: Number(m[1]), month };
}

function num(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const n = Number(String(value ?? '').replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : null;
}

/** 열 구성: [항만, 합계TEU, 전년비, 輸出TEU, 전년비, 輸入TEU, 전년비] */
export function parsePrelimSheet(
  sheet: (string | number)[][],
  year: number,
  month: number,
): PrelimRow[] {
  const rows: PrelimRow[] = [];
  for (const raw of sheet) {
    const portCode = PRELIM_PORTS[String(raw?.[0] ?? '').trim()];
    if (!portCode) continue;
    const teu = num(raw[1]);
    if (teu === null) continue; // 헤더 행이거나 비공표
    // 前年同月比는 변화율이 아니라 지수로 들어온다(100.128 = +0.128%).
    const yoyIndex = num(raw[2]);
    rows.push({
      port_code: portCode,
      country: 'JP',
      year,
      month,
      teu,
      export_teu: num(raw[3]),
      import_teu: num(raw[5]),
      yoy_pct: yoyIndex === null ? null : yoyIndex - 100,
      is_preliminary: true,
      source: SOURCE,
      source_url: SOURCE_URL,
    });
  }
  return rows;
}

interface CatalogEntry {
  year: number;
  month: number;
  url: string;
}

async function fetchCatalog(appId: string): Promise<CatalogEntry[]> {
  const url = `${CATALOG}?appId=${appId}&statsCode=${STATS_CODE}&limit=100&searchWord=${encodeURIComponent('速報')}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error(`e-Stat 카탈로그 HTTP ${res.status}`);
  const json = await res.json();
  if (json?.GET_DATA_CATALOG?.RESULT?.STATUS !== 0) {
    throw new Error(`e-Stat 카탈로그 오류: ${json?.GET_DATA_CATALOG?.RESULT?.ERROR_MSG}`);
  }
  const list = ([] as any[]).concat(json.GET_DATA_CATALOG.DATA_CATALOG_LIST_INF?.DATA_CATALOG_INF ?? []);

  const entries: CatalogEntry[] = [];
  for (const item of list) {
    const dataset = item.DATASET ?? {};
    const title = String(dataset.TITLE?.$ ?? dataset.TITLE?.NAME ?? dataset.TITLE ?? '');
    const period = parsePeriodFromTitle(title);
    if (!period) continue;
    // XLS만 쓴다. PDF는 파싱이 불안정하고 2020년 10월 이전 회차에만 남아 있다.
    const xls = ([] as any[]).concat(item.RESOURCES?.RESOURCE ?? []).find((r) => r.FORMAT === 'XLS');
    if (!xls?.URL) continue;
    entries.push({ ...period, url: String(xls.URL) });
  }
  entries.sort((a, b) => b.year * 12 + b.month - (a.year * 12 + a.month));
  return entries.slice(0, RECENT_MONTHS);
}

async function fetchSheet(url: string): Promise<(string | number)[][]> {
  const res = await fetch(url, { signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error(`XLS HTTP ${res.status}`);
  const wb = XLSX.read(Buffer.from(await res.arrayBuffer()), { type: 'buffer' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false }) as (string | number)[][];
}

export async function collect(): Promise<CollectorResult> {
  const result: CollectorResult = { section: 'shipping', data: [] };
  const appId = process.env.ESTAT_APP_ID;

  if (!appId) {
    console.warn('⚠️ ESTAT_APP_ID 미설정 — 일본 항만 속보 건너뜀');
    result.data.push({
      data_type: 'port_stat', data_key: 'PORT_JP_PRELIM_error', data_value: {},
      source: SOURCE, source_url: SOURCE_URL, is_complete: false,
      error_message: 'ESTAT_APP_ID 미설정',
    });
    return result;
  }

  try {
    const entries = await rateLimited('e-Stat 港湾速報 카탈로그', () => fetchCatalog(appId));
    if (entries.length === 0) throw new Error('XLS가 있는 회차 없음 — 카탈로그 구성 변경 의심');

    const rows: PrelimRow[] = [];
    const failed: string[] = [];
    for (const entry of entries) {
      const label = `${entry.year}-${String(entry.month).padStart(2, '0')}`;
      try {
        const sheet = await rateLimited(`港湾速報 ${label}`, () => fetchSheet(entry.url));
        const parsed = parsePrelimSheet(sheet, entry.year, entry.month);
        if (parsed.length === 0) failed.push(`${label}(파싱 0건)`);
        rows.push(...parsed);
      } catch (e) {
        // 한 회차가 깨져도 나머지는 살린다.
        failed.push(`${label}(${(e as Error).message})`);
      }
    }

    if (failed.length > 0) console.warn(`⚠️ 속보 ${failed.length}개 회차 실패: ${failed.slice(0, 5).join(', ')}`);
    if (rows.length === 0) throw new Error('적재할 행 없음');

    await dbUpsert(
      'port_throughput',
      rows as unknown as Record<string, unknown>[],
      'port_code,year,month',
    );

    const latest = rows.reduce((a, b) => (a.year * 12 + a.month >= b.year * 12 + b.month ? a : b));
    const total = rows.find(
      (r) => r.port_code === 'JP_MAJOR6' && r.year === latest.year && r.month === latest.month,
    );
    console.log(
      `✅ 일본 항만 속보: ${rows.length}건 저장 (최신 ${latest.year}-${String(latest.month).padStart(2, '0')}`
      + `${total ? `, 主要6港 ${total.teu.toLocaleString()} TEU` : ''})`,
    );
    result.data.push({
      data_type: 'port_stat', data_key: 'PORT_JP_PRELIM',
      data_value: { count: rows.length, months: entries.length, failed: failed.length },
      source: SOURCE, source_url: SOURCE_URL, is_complete: true,
    });
  } catch (e) {
    console.warn(`⚠️ 일본 항만 속보 실패: ${(e as Error).message}`);
    result.data.push({
      data_type: 'port_stat', data_key: 'PORT_JP_PRELIM_error', data_value: {},
      source: SOURCE, source_url: SOURCE_URL, is_complete: false,
      error_message: (e as Error).message,
    });
  }

  return result;
}

if (require.main === module) {
  collect().catch(console.error);
}
