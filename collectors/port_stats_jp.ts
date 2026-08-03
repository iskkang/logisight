// collectors/port_stats_jp.ts
// 일본 항만 컨테이너 물동량 수집기 — port_throughput 테이블에 저장(country='JP').
// 소스: 政府統計の総合窓口(e-Stat) API / 国土交通省 港湾調査 第５表 コンテナ個数表(월차, 2010년 1월~)
//
// 주의 1: 이 표는 확보(確報)라 최신 시점이 약 9개월 지연된다. 속보성 수치는
//         국토교통성 보도자료 港湾統計速報(주요 6항, 약 2개월 지연)가 따로 있다.
// 주의 2: 최신 몇 개월은 항만에 따라 미집계 상태로 극단적으로 낮은 값이 들어온다
//         (예: 東京 輸出 2025-07 154,408 → 2025-08 3,688). 그대로 적재하면
//         사이트에 물동량 급감으로 표시되므로 filterImplausible로 걸러낸다.

import { rateLimited } from './utils/rate_limiter';
import { dbUpsert } from './utils/supabase_writer';
import type { CollectorResult } from './types';

const API = 'https://api.e-stat.go.jp/rest/3.0/app/json/getStatsData';
const STATS_DATA_ID = '0003130478';
const SOURCE = '国土交通省 港湾調査 (e-Stat)';
const SOURCE_URL = 'https://www.e-stat.go.jp/dbview?sid=0003130478';

// 輸出(110)·輸入(120)만 집계한다. 移出(130)·移入(140)은 내항 물동량이라
// 외국무역 컨테이너 비교에 섞으면 다른 나라 항만과 견줄 수 없게 된다.
const TRADE_CATS = ['110', '120'];

/** e-Stat 甲種港湾 코드 → UN/LOCODE. 국가 구분은 country 컬럼이 하고, 코드는 표기·조인용이다. */
export const JP_PORTS: Record<string, string> = {
  '00500': 'JP_ALL', // 全国
  '01007': 'JPTMK',  // 苫小牧
  '12003': 'JPCHB',  // 千葉
  '13001': 'JPTYO',  // 東京
  '14001': 'JPKWS',  // 川崎
  '14002': 'JPYOK',  // 横浜
  '22003': 'JPSMZ',  // 清水
  '23003': 'JPNGO',  // 名古屋
  '24001': 'JPYKK',  // 四日市
  '27006': 'JPOSA',  // 大阪
  '28002': 'JPUKB',  // 神戸
  '40001': 'JPHKT',  // 博多
  '40002': 'JPKKJ',  // 北九州
  '47003': 'JPNAH',  // 那覇
};

export interface EstatValue {
  '@cat01': string;
  '@cat02': string;
  '@time': string;
  $: string;
}

export interface PortRow {
  port_code: string;
  country: string;
  year: number;
  month: number;
  teu: number;
  source: string;
  source_url: string;
}

/** 월차 시간축 코드는 YYYY + '00' + MM + MM 형태다 (2025年10月 = '2025001010'). */
export function parseEstatTime(code: string): { year: number; month: number } | null {
  if (!/^\d{4}00\d{4}$/.test(code)) return null;
  const year = Number(code.slice(0, 4));
  const month = Number(code.slice(6, 8));
  if (!(month >= 1 && month <= 12)) return null;
  return { year, month };
}

/** 같은 항만·같은 달의 輸出+輸入을 합산해 적재용 행으로 만든다. */
export function buildPortRows(values: EstatValue[]): PortRow[] {
  const acc = new Map<string, PortRow>();
  for (const v of values) {
    if (!TRADE_CATS.includes(v['@cat01'])) continue;
    const portCode = JP_PORTS[v['@cat02']];
    if (!portCode) continue;
    const t = parseEstatTime(v['@time']);
    if (!t) continue;
    const teu = Number(String(v.$).replace(/,/g, ''));
    if (!Number.isFinite(teu)) continue; // '-', 'X' 등 비공표 기호
    const key = `${portCode}_${t.year}_${t.month}`;
    const existing = acc.get(key);
    if (existing) existing.teu += teu;
    else {
      acc.set(key, {
        port_code: portCode,
        country: 'JP',
        year: t.year,
        month: t.month,
        teu,
        source: SOURCE,
        source_url: SOURCE_URL,
      });
    }
  }
  return [...acc.values()];
}

/** 직전 이력 중앙값의 20% 미만이면 미집계로 본다. 이력이 3건 미만이면 판단하지 않는다. */
export function isPlausibleTeu(teu: number, history: number[]): boolean {
  if (history.length < 3) return true;
  const sorted = [...history].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  if (median <= 0) return true;
  return teu >= median * 0.2;
}

/** 항만별로 시간순 이력을 쌓으며 급락 값을 분리한다. */
export function filterImplausible(rows: PortRow[]): { kept: PortRow[]; dropped: PortRow[] } {
  const byPort = new Map<string, PortRow[]>();
  for (const r of rows) {
    const list = byPort.get(r.port_code) ?? [];
    list.push(r);
    byPort.set(r.port_code, list);
  }
  const kept: PortRow[] = [];
  const dropped: PortRow[] = [];
  for (const list of byPort.values()) {
    list.sort((a, b) => a.year - b.year || a.month - b.month);
    const history: number[] = [];
    for (const r of list) {
      if (isPlausibleTeu(r.teu, history)) {
        kept.push(r);
        history.push(r.teu);
      } else {
        dropped.push(r);
      }
    }
  }
  return { kept, dropped };
}

async function fetchStats(appId: string, timeFrom: string): Promise<EstatValue[]> {
  const url =
    `${API}?appId=${appId}&statsDataId=${STATS_DATA_ID}` +
    `&cdCat01=${TRADE_CATS.join(',')}` +
    `&cdCat02=${Object.keys(JP_PORTS).join(',')}` +
    `&cdTimeFrom=${timeFrom}&limit=100000`;
  const res = await fetch(url, { signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error(`e-Stat HTTP ${res.status}`);
  const json = await res.json();
  const result = json?.GET_STATS_DATA?.RESULT;
  if (result?.STATUS !== 0) throw new Error(`e-Stat STATUS ${result?.STATUS}: ${result?.ERROR_MSG}`);
  return ([] as EstatValue[]).concat(json.GET_STATS_DATA?.STATISTICAL_DATA?.DATA_INF?.VALUE ?? []);
}

/** 기본 5년치. 첫 실행이 곧 백필이 되고, 이후 실행은 같은 범위를 덮어써 수정치를 반영한다. */
function defaultTimeFrom(yearsBack = 5): string {
  const from = new Date();
  from.setUTCFullYear(from.getUTCFullYear() - yearsBack);
  const y = from.getUTCFullYear();
  const m = String(from.getUTCMonth() + 1).padStart(2, '0');
  return `${y}00${m}${m}`;
}

export async function collect(): Promise<CollectorResult> {
  const result: CollectorResult = { section: 'shipping', data: [] };
  const appId = process.env.ESTAT_APP_ID;

  if (!appId) {
    console.warn('⚠️ ESTAT_APP_ID 미설정 — 일본 항만 수집 건너뜀');
    result.data.push({
      data_type: 'port_stat', data_key: 'PORT_JP_ESTAT_error', data_value: {},
      source: SOURCE, source_url: SOURCE_URL, is_complete: false,
      error_message: 'ESTAT_APP_ID 미설정',
    });
    return result;
  }

  try {
    const values = await rateLimited('e-Stat 港湾調査', () => fetchStats(appId, defaultTimeFrom()));
    const { kept, dropped } = filterImplausible(buildPortRows(values));

    if (dropped.length > 0) {
      // 조용히 버리면 나중에 데이터 공백의 원인을 못 찾는다.
      const sample = dropped.slice(0, 5)
        .map((r) => `${r.port_code} ${r.year}-${String(r.month).padStart(2, '0')} ${r.teu}TEU`)
        .join(', ');
      console.warn(`⚠️ 미집계 의심으로 제외 ${dropped.length}건: ${sample}${dropped.length > 5 ? ' …' : ''}`);
    }

    if (kept.length === 0) throw new Error('적재할 행 없음');

    await dbUpsert(
      'port_throughput',
      kept as unknown as Record<string, unknown>[],
      'port_code,year,month',
    );

    const latest = kept.reduce((a, b) => (a.year * 12 + a.month >= b.year * 12 + b.month ? a : b));
    console.log(`✅ 일본 항만: ${kept.length}건 저장 (최신 ${latest.year}-${String(latest.month).padStart(2, '0')})`);
    result.data.push({
      data_type: 'port_stat', data_key: 'PORT_JP_ESTAT',
      data_value: { count: kept.length, dropped: dropped.length, latest: `${latest.year}-${latest.month}` },
      source: SOURCE, source_url: SOURCE_URL, is_complete: true,
    });
  } catch (e) {
    console.warn(`⚠️ 일본 항만 수집 실패: ${(e as Error).message}`);
    result.data.push({
      data_type: 'port_stat', data_key: 'PORT_JP_ESTAT_error', data_value: {},
      source: SOURCE, source_url: SOURCE_URL, is_complete: false,
      error_message: (e as Error).message,
    });
  }

  return result;
}

if (require.main === module) {
  collect().catch(console.error);
}
