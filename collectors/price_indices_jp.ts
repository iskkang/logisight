// collectors/price_indices_jp.ts
// 일본 화물운송 서비스 가격지수 수집기 — jp_price_indices 테이블에 적재.
// 소스: 日本銀行 企業向けサービス価格指数(SPPI) 일괄 다운로드
//       https://www.stat-search.boj.or.jp/info/sppi_m_jp.zip (ZIP → Shift_JIS CSV)
//
// 일본에는 한국의 운임공표제 같은 실물 운임 공표가 없다. 대신 이 지수가 외항·국제항공
// 화물운송 가격의 유일한 공식 월차 시계열이다(2020=100, 약 1개월 지연).
//
// 기준 구분이 중요하다. 같은 지표가 세 갈래로 나온다:
//   yen      (52) 본계열. 엔 베이스 — 운임 변동과 환율 변동이 함께 들어간다
//   contract (51) 참고계열. 계약통화 베이스 — 환율 효과를 뺀 순수 운임에 가깝다
//   ex_tax   (42) 소비세 제외
// 외항화물은 달러로 계약하므로 둘이 크게 벌어진다(2026-06: 엔 233.8 vs 계약통화 160.8).
// 구분 없이 인용하면 기사에 틀린 해석이 나가므로 basis를 함께 저장한다.

import { rateLimited } from './utils/rate_limiter';
import { dbUpsert } from './utils/supabase_writer';
import type { CollectorResult } from './types';

const ZIP_URL = 'https://www.stat-search.boj.or.jp/info/sppi_m_jp.zip';
const SOURCE = '日本銀行 企業向けサービス価格指数(SPPI)';
const SOURCE_URL = 'https://www.boj.or.jp/statistics/pi/cspi_release/index.htm';
const BASE_YEAR = '2020';

/** 계열 코드 접두어 → 기준 구분. 여기 없는 접두어(52B 등 참고 조합계열)는 수집하지 않는다. */
const BASIS_BY_PREFIX: Record<string, string> = {
  '52': 'yen',
  '51': 'contract',
  '42': 'ex_tax',
};

/** 수집 대상 계열(코드 뒷 8자리) → 표시명·카테고리. 514계열 전부가 아니라 화물운송만 담는다. */
export const TARGET_SERIES: Record<string, { name: string; category: string }> = {
  '00010003': { name: '運輸・郵便', category: 'total' },
  '00620001': { name: '陸上貨物輸送', category: 'land' },
  '00630001': { name: '鉄道貨物輸送', category: 'land' },
  '00630002': { name: '道路貨物輸送', category: 'land' },
  '00720001': { name: '海上貨物輸送', category: 'ocean' },
  '00730001': { name: '外航貨物輸送', category: 'ocean' },
  '00730002': { name: '内航貨物輸送', category: 'ocean' },
  '00730003': { name: '港湾運送', category: 'port' },
  '00750001': { name: '外航貨物輸送（除外航タンカー）', category: 'ocean' },
  '00820001': { name: '航空貨物輸送', category: 'air' },
  '00830001': { name: '国際航空貨物輸送', category: 'air' },
  '00830002': { name: '国内航空貨物輸送', category: 'air' },
  '00930001': { name: '倉庫', category: 'warehouse' },
};

export interface IndexRow {
  series_code: string;
  series_name: string;
  basis: string;
  category: string;
  year: number;
  month: number;
  value: number;
  base_year: string;
  source: string;
  source_url: string;
}

/** PRCS20_ + 기준구분(2자리) + 계열번호(8자리). 대상이 아니면 null. */
export function parseSeriesCode(code: string): { basis: string; suffix: string } | null {
  const m = /^PRCS20_(\d{2})(\d{8})$/.exec(code.trim());
  if (!m) return null;
  const basis = BASIS_BY_PREFIX[m[1]];
  if (!basis) return null;
  return { basis, suffix: m[2] };
}

export function parsePeriod(period: string): { year: number; month: number } | null {
  if (!/^\d{6}$/.test(period)) return null;
  const year = Number(period.slice(0, 4));
  const month = Number(period.slice(4, 6));
  if (!(month >= 1 && month <= 12)) return null;
  return { year, month };
}

/** BOJ CSV는 계열이 행, 월이 열인 와이드 포맷이다. 세로로 펴서 적재 행을 만든다. */
export function buildIndexRows(csvText: string): IndexRow[] {
  const lines = csvText.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];

  const periods = lines[0].split(',').slice(3).map((p) => p.trim());
  const rows: IndexRow[] = [];

  for (const line of lines.slice(1)) {
    const m = /^([^,]+),"([^"]*)","([^"]*)",(.*)$/.exec(line);
    if (!m) continue;
    const [, code, , rawName, rest] = m;

    const parsed = parseSeriesCode(code);
    if (!parsed) continue;
    const target = TARGET_SERIES[parsed.suffix];
    if (!target) continue;

    // 원본 명칭은 "小類別/__外航貨物輸送" 형태 — 분류 접두어와 자릿수 표시 밑줄을 걷어낸다.
    const cleaned = rawName.split('/').pop()?.replace(/_/g, '').trim();
    const seriesName = cleaned || target.name;

    const values = rest.split(',');
    for (let i = 0; i < periods.length; i += 1) {
      const period = parsePeriod(periods[i]);
      if (!period) continue;
      const raw = (values[i] ?? '').trim();
      if (!raw) continue; // 미공표 월
      const value = Number(raw);
      if (!Number.isFinite(value)) continue;
      rows.push({
        series_code: code,
        series_name: seriesName,
        basis: parsed.basis,
        category: target.category,
        year: period.year,
        month: period.month,
        value,
        base_year: BASE_YEAR,
        source: SOURCE,
        source_url: SOURCE_URL,
      });
    }
  }
  return rows;
}

/** ZIP 안의 CSV 한 개를 꺼낸다. 의존성을 늘리지 않으려고 stored/deflate만 직접 처리한다. */
async function extractCsvFromZip(buf: Buffer): Promise<string> {
  const zlib = await import('node:zlib');
  // 로컬 파일 헤더 시그니처 PK\x03\x04
  const sig = buf.indexOf(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
  if (sig < 0) throw new Error('ZIP 시그니처 없음');
  const method = buf.readUInt16LE(sig + 8);
  const compressedSize = buf.readUInt32LE(sig + 18);
  const nameLen = buf.readUInt16LE(sig + 26);
  const extraLen = buf.readUInt16LE(sig + 28);
  const start = sig + 30 + nameLen + extraLen;
  const body = buf.subarray(start, start + compressedSize);
  const raw = method === 0 ? body : zlib.inflateRawSync(body);
  // BOJ CSV는 Shift_JIS다. UTF-8로 읽으면 계열명이 깨져 대상 필터가 통째로 빗나간다.
  return new TextDecoder('shift_jis').decode(raw);
}

async function fetchSppiCsv(): Promise<string> {
  const res = await fetch(ZIP_URL, { signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error(`BOJ HTTP ${res.status}`);
  return extractCsvFromZip(Buffer.from(await res.arrayBuffer()));
}

export async function collect(): Promise<CollectorResult> {
  const result: CollectorResult = { section: 'shipping', data: [] };

  try {
    const csv = await rateLimited('BOJ SPPI', fetchSppiCsv);
    const rows = buildIndexRows(csv);
    if (rows.length === 0) throw new Error('적재할 행 없음 — CSV 포맷 변경 의심');

    await dbUpsert(
      'jp_price_indices',
      rows as unknown as Record<string, unknown>[],
      'series_code,year,month',
    );

    const latest = rows.reduce((a, b) => (a.year * 12 + a.month >= b.year * 12 + b.month ? a : b));
    const ocean = rows.find(
      (r) => r.series_name === '外航貨物輸送' && r.basis === 'yen'
        && r.year === latest.year && r.month === latest.month,
    );
    console.log(
      `✅ 일본 가격지수: ${rows.length}건 저장 (최신 ${latest.year}-${String(latest.month).padStart(2, '0')}`
      + `${ocean ? `, 외항화물 ${ocean.value}` : ''})`,
    );
    result.data.push({
      data_type: 'price_index', data_key: 'JP_SPPI',
      data_value: { count: rows.length, latest: `${latest.year}-${latest.month}` },
      source: SOURCE, source_url: SOURCE_URL, is_complete: true,
    });
  } catch (e) {
    console.warn(`⚠️ 일본 가격지수 수집 실패: ${(e as Error).message}`);
    result.data.push({
      data_type: 'price_index', data_key: 'JP_SPPI_error', data_value: {},
      source: SOURCE, source_url: SOURCE_URL, is_complete: false,
      error_message: (e as Error).message,
    });
  }

  return result;
}

if (require.main === module) {
  collect().catch(console.error);
}
