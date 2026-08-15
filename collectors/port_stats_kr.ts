// collectors/port_stats_kr.ts
// 한국 컨테이너 물동량 수집기 — port_throughput 테이블에 저장(country='KR', port_code='KR_ALL').
// 소스: 공공데이터포털 해양수산부_수출입컨테이너처리실적 (apis.data.go.kr/1192000/SsopCargContnImxprt2/Ym)
//
// 주의 1: 이름은 "수출입"이지만 실제로는 전국 총 물동량이다 ★
//         e(eContnTeuTotal)·t(tContnTeuTotal)는 수출입 구분이 아니라 양하/적하 기준이라,
//         환적 컨테이너가 양쪽에 한 번씩 잡혀 e+t 가 총 처리량이 된다.
//         2026-08-15 실측 대조:
//           API 2025 합계 e+t = 31.95M TEU
//           해수부 공표 2025 전국 총 물동량 = 32.11M TEU  (수출입 17.53M + 환적 14.41M)
//           → 차이 −0.5%. 공표 "수출입 17.53M"과는 전혀 안 맞는다.
//         즉 HK·TW·JP 의 총 처리량과 같은 축이다. e/t 를 수출입으로 적재하면 안 된다.
//
// 주의 2: numOfRows 가 50 에서 캡된다 ★
//         numOfRows=500 을 넣어도 50건만 돌려준다. 한 페이지만 읽으면 12개 지역 × 4개월 +2 로
//         잘린 상태가 되고, 마지막 달이 "지역 2개만 있는 미완월"처럼 보인다. 그대로 합치면
//         그 달 물동량이 절반 이하로 적재된다. 반드시 totalCount 까지 페이지를 넘긴다.
//
// 주의 3: 항만별 분해가 불가능하다. 파라미터가 sym/eym 뿐이고 응답 차원은 해외지역별이다.
//         부산·인천 분해가 필요해지면 다른 소스를 찾아야 한다(KOSIS 해수부 표 등).
//
// 주의 4: 기존 collectors/port_stats.ts 의 KOSIS 경로는 쓰지 않는다.
//         tblId=DT_134001_002 는 관세청 "국가별 수출입현황"(천불)이라 항만 통계가 아니다.
//         유효한 키를 넣어도 항만명 매칭이 0건이라 조용히 0행을 반환한다.

import * as path from 'path';
import * as dotenv from 'dotenv';

import { dbUpsert } from './utils/supabase_writer';
import type { CollectorResult } from './types';

// 단독 실행 시에는 index.ts를 거치지 않아 env가 비어 있다.
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

const API = 'https://apis.data.go.kr/1192000/SsopCargContnImxprt2/Ym';
const SOURCE = '해양수산부 수출입컨테이너처리실적 (공공데이터포털)';
const SOURCE_URL = 'https://www.data.go.kr/data/15059131/openapi.do';

/** 응답이 돌려주는 해외지역 수. 이보다 적은 달은 아직 다 안 찬 것으로 보고 버린다. */
export const EXPECTED_AREAS = 12;

/** API 가 실제로 돌려주는 페이지 크기. numOfRows 를 키워도 이 값에서 잘린다. */
const PAGE_SIZE = 50;

export interface KrPortRow {
  port_code: 'KR_ALL';
  country: 'KR';
  year: number;
  month: number;
  teu: number;
  /** 이 소스의 e/t 는 수출입이 아니라 양하/적하다. 수출입으로 오독되지 않도록 비워 둔다. */
  export_teu: null;
  import_teu: null;
  yoy_pct: null;
  is_preliminary: false;
  source: string;
  source_url: string;
}

export interface AreaItem {
  useYm: string;
  eContnTeuTotal: number;
  tContnTeuTotal: number;
}

function tagValue(xml: string, tag: string): string | null {
  const m = xml.match(new RegExp(`<${tag}>([^<]*)</${tag}>`));
  return m ? m[1] : null;
}

/** XML 한 페이지 → item 배열. 숫자로 못 읽는 값은 버린다(0으로 채우지 않는다). */
export function parsePage(xml: string): AreaItem[] {
  const out: AreaItem[] = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const body = m[1];
    const useYm = tagValue(body, 'useYm');
    if (!useYm || !/^\d{6}$/.test(useYm)) continue;
    const e = Number(tagValue(body, 'eContnTeuTotal'));
    const t = Number(tagValue(body, 'tContnTeuTotal'));
    if (!Number.isFinite(e) || !Number.isFinite(t)) continue;
    out.push({ useYm, eContnTeuTotal: e, tContnTeuTotal: t });
  }
  return out;
}

/**
 * 해외지역별 item → 월별 전국 합계 행.
 * 지역이 EXPECTED_AREAS 만큼 안 찬 달은 잘렸거나 아직 안 채워진 것이라 버린다 —
 * 부분 합계를 실적으로 적재하면 물동량 급감으로 나간다.
 */
export function buildRows(items: AreaItem[]): { rows: KrPortRow[]; partial: string[] } {
  const acc = new Map<string, { teu: number; n: number }>();
  for (const it of items) {
    const cur = acc.get(it.useYm) ?? { teu: 0, n: 0 };
    cur.teu += it.eContnTeuTotal + it.tContnTeuTotal;
    cur.n += 1;
    acc.set(it.useYm, cur);
  }

  const rows: KrPortRow[] = [];
  const partial: string[] = [];
  for (const [ym, v] of [...acc.entries()].sort()) {
    if (v.n < EXPECTED_AREAS) { partial.push(`${ym}(지역 ${v.n}/${EXPECTED_AREAS})`); continue; }
    rows.push({
      port_code: 'KR_ALL',
      country: 'KR',
      year: Number(ym.slice(0, 4)),
      month: Number(ym.slice(4, 6)),
      teu: Math.round(v.teu),
      export_teu: null,
      import_teu: null,
      yoy_pct: null,
      is_preliminary: false,
      source: SOURCE,
      source_url: SOURCE_URL,
    });
  }
  return { rows, partial };
}

/** sym~eym 구간을 totalCount 까지 전부 받아온다. 받은 건수가 다르면 던진다. */
export async function fetchRange(sym: string, eym: string): Promise<AreaItem[]> {
  const key = process.env.DATA_GO_KR_API_KEY;
  if (!key) throw new Error('DATA_GO_KR_API_KEY 미설정');

  const items: AreaItem[] = [];
  let expected: number | null = null;

  for (let page = 1; page <= 200; page++) {
    const url = `${API}?serviceKey=${key}&sym=${sym}&eym=${eym}&numOfRows=${PAGE_SIZE}&pageNo=${page}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const xml = await res.text();

    // data.go.kr 은 오류도 HTTP 200 으로 준다. resultCode 를 직접 본다.
    const code = tagValue(xml, 'resultCode');
    if (code && code !== '00') {
      throw new Error(`resultCode ${code}: ${tagValue(xml, 'resultMsg') ?? ''}`);
    }
    if (expected === null) {
      const tc = tagValue(xml, 'totalCount');
      expected = tc ? Number(tc) : null;
      if (expected === null || !Number.isFinite(expected)) throw new Error('totalCount 없음');
    }

    const page$ = parsePage(xml);
    items.push(...page$);
    if (items.length >= expected || page$.length === 0) break;
  }

  // 페이지네이션을 빠뜨리면 여기서 걸린다. 조용히 잘린 값을 적재하지 않는다.
  if (items.length !== expected) {
    throw new Error(`수집 건수 불일치: ${items.length} / totalCount ${expected}`);
  }
  return items;
}

/** 기본 조회 구간 — 최근 36개월(백필 목표와 동일). */
export function defaultRange(now: Date): { sym: string; eym: string } {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - 35, 1));
  const fmt = (d: Date) => `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  return { sym: fmt(start), eym: fmt(end) };
}

export async function collect(): Promise<CollectorResult> {
  const result: CollectorResult = { section: 'shipping', data: [] };
  try {
    const argSym = process.argv.find((a) => a.startsWith('--sym='))?.split('=')[1];
    const argEym = process.argv.find((a) => a.startsWith('--eym='))?.split('=')[1];
    const { sym, eym } = argSym && argEym ? { sym: argSym, eym: argEym } : defaultRange(new Date());

    const items = await fetchRange(sym, eym);
    const { rows, partial } = buildRows(items);
    if (partial.length > 0) console.warn(`⚠️ 미완월 제외: ${partial.join(', ')}`);
    if (rows.length === 0) throw new Error('적재할 행 없음');

    if (process.argv.includes('--dry-run')) {
      const latest = rows[rows.length - 1];
      console.log(`[dry-run] ${sym}~${eym} · ${rows.length}건 · 최신 ${latest.year}-${String(latest.month).padStart(2, '0')} ${latest.teu.toLocaleString()} TEU`);
      return result;
    }

    await dbUpsert('port_throughput', rows as unknown as Record<string, unknown>[], 'port_code,year,month');

    const latest = rows[rows.length - 1];
    console.log(`✅ 한국 항만: ${rows.length}건 저장 (최신 ${latest.year}-${String(latest.month).padStart(2, '0')})`);
    result.data.push({
      data_type: 'port_stat', data_key: 'PORT_KR_DATAGOKR',
      data_value: { count: rows.length, partial: partial.length, latest: `${latest.year}-${latest.month}` },
      source: SOURCE, source_url: SOURCE_URL, is_complete: true,
    });
  } catch (e) {
    console.warn(`⚠️ 한국 항만 수집 실패: ${(e as Error).message}`);
    result.data.push({
      data_type: 'port_stat', data_key: 'PORT_KR_DATAGOKR_error', data_value: {},
      source: SOURCE, source_url: SOURCE_URL, is_complete: false,
      error_message: (e as Error).message,
    });
  }
  return result;
}

if (require.main === module) {
  collect().catch(console.error);
}
