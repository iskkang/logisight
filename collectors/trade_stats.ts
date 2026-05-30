// collectors/trade_stats.ts
// 관세청 공공데이터포털 OpenAPI — 한국 무역통계 수집기
// 대상 테이블: trade_statistics
// 소스 A: 국가별 수출입실적 (kcustomsCtntTradeCountry)
// 소스 B: 품목별 수출입실적 (nitemtrade)

import ws from 'ws';
// @ts-ignore — Node 20 lacks a native WebSocket
globalThis.WebSocket = ws as never;

import { createClient } from '@supabase/supabase-js';
import type { CollectorResult } from './types';

const API_BASE = 'http://apis.data.go.kr';
const DELAY_MS = 200; // data.go.kr 개발계정 레이트 리밋 준수

// 한국 주요 교역 상대국 (ISO 3166-1 alpha-2)
const TARGET_COUNTRIES = [
  { code: 'CN', name: '중국' },
  { code: 'US', name: '미국' },
  { code: 'VN', name: '베트남' },
  { code: 'JP', name: '일본' },
  { code: 'DE', name: '독일' },
  { code: 'AU', name: '호주' },
  { code: 'TW', name: '대만' },
  { code: 'HK', name: '홍콩' },
  { code: 'SG', name: '싱가포르' },
  { code: 'SA', name: '사우디아라비아' },
  { code: 'NL', name: '네덜란드' },
  { code: 'MY', name: '말레이시아' },
  { code: 'IN', name: '인도' },
  { code: 'AE', name: 'UAE' },
  { code: 'PL', name: '폴란드' },
  { code: 'KZ', name: '카자흐스탄' },
];

// 주요 HS 2단위 품목
const TARGET_HS_CHAPTERS = [
  { code: '84', name: '원자로·기계류' },
  { code: '85', name: '전기기기·전자제품' },
  { code: '87', name: '자동차·부품' },
  { code: '72', name: '철강' },
  { code: '39', name: '플라스틱' },
  { code: '27', name: '광물성 연료·오일' },
  { code: '29', name: '유기화학품' },
  { code: '90', name: '광학기기·의료기기' },
];

interface TradeRow {
  period: string;
  stat_type: 'country' | 'item';
  hs_code: string | null;
  hs_name: string | null;
  country_code: string | null;
  country_name: string | null;
  export_usd: number | null;
  export_weight: number | null;
  import_usd: number | null;
  import_weight: number | null;
  trade_balance: number | null;
  data_source: string;
}

function sleep(ms: number) {
  return new Promise<void>(resolve => setTimeout(resolve, ms));
}

// 전월 YYYYMM 계산
function getPrevPeriod(): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

// CLI 인수 파싱: --period=YYYYMM
function parsePeriodArg(): string {
  const arg = process.argv.find(a => a.startsWith('--period='));
  if (arg) {
    const p = arg.split('=')[1];
    if (/^\d{6}$/.test(p)) return p;
    console.warn(`[trade_stats] 잘못된 --period 형식: ${p}, 전월로 대체`);
  }
  return getPrevPeriod();
}

// API 응답에서 items 배열 추출 (data.go.kr 두 가지 응답 구조 대응)
function extractItems(body: Record<string, unknown>): unknown[] {
  const items = (body as Record<string, unknown>)['items'];
  if (!items) return [];
  if (Array.isArray(items)) return items;
  // { item: [...] } 또는 { item: {...} } 구조
  const item = (items as Record<string, unknown>)['item'];
  if (Array.isArray(item)) return item;
  if (item && typeof item === 'object') return [item];
  return [];
}

function toNum(val: unknown): number | null {
  if (val === null || val === undefined || val === '') return null;
  const n = Number(String(val).replace(/,/g, ''));
  return isNaN(n) ? null : n;
}

// ── 소스 A: 국가별 수출입실적 ─────────────────────────────────────────
async function fetchCountryStats(
  yr: string,
  mt: string,
  countryCd: string,
  apiKey: string
): Promise<TradeRow | null> {
  const url = new URL(`${API_BASE}/1220000/kcustomsCtntTradeCountry/getKcustomsCtntTradeCountryList`);
  url.searchParams.set('serviceKey', apiKey);
  url.searchParams.set('type', 'json');
  url.searchParams.set('strtYr', yr);
  url.searchParams.set('strtMt', mt);
  url.searchParams.set('endYr', yr);
  url.searchParams.set('endMt', mt);
  url.searchParams.set('cntyCd', countryCd);
  url.searchParams.set('numOfRows', '10');

  const res = await fetch(url.toString(), { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json() as { response?: { body?: unknown } };

  const body = json?.response?.body as Record<string, unknown> | undefined;
  if (!body) return null;

  const items = extractItems(body);
  if (items.length === 0) return null;

  // 첫 번째 항목으로 필드명 확인 (디버그 — API 버전에 따라 필드명 다를 수 있음)
  const raw = items[0] as Record<string, unknown>;

  // 응답 필드명 후보 처리 (expDlr / expAmt 두 가지 버전 대응)
  const expUsd = toNum(raw['expDlr'] ?? raw['expAmt'] ?? raw['exportAmt']);
  const impUsd = toNum(raw['impDlr'] ?? raw['impAmt'] ?? raw['importAmt']);
  const expKg  = toNum(raw['expWgt'] ?? raw['exportWgt']);
  const impKg  = toNum(raw['impWgt'] ?? raw['importWgt']);
  const name   = String(raw['cntyKrNm'] ?? raw['cntyNm'] ?? raw['cntyEnNm'] ?? countryCd);
  const period = `${yr}-${mt}`;

  return {
    period,
    stat_type: 'country',
    hs_code: null,
    hs_name: null,
    country_code: countryCd,
    country_name: name,
    export_usd: expUsd,
    export_weight: expKg,
    import_usd: impUsd,
    import_weight: impKg,
    trade_balance: expUsd !== null && impUsd !== null ? expUsd - impUsd : null,
    data_source: '관세청 공공데이터포털',
  };
}

// ── 소스 B: 품목별 수출입실적 ─────────────────────────────────────────
async function fetchItemStats(
  yr: string,
  mt: string,
  hsCd: string,
  apiKey: string
): Promise<TradeRow | null> {
  const url = new URL(`${API_BASE}/1220000/nitemtrade/getNitemtradeList`);
  url.searchParams.set('serviceKey', apiKey);
  url.searchParams.set('type', 'json');
  url.searchParams.set('strtYr', yr);
  url.searchParams.set('strtMt', mt);
  url.searchParams.set('endYr', yr);
  url.searchParams.set('endMt', mt);
  url.searchParams.set('hsCd', hsCd);
  url.searchParams.set('imxprtSe', 'A'); // A = 수출입 합산
  url.searchParams.set('numOfRows', '10');

  const res = await fetch(url.toString(), { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json() as { response?: { body?: unknown } };

  const body = json?.response?.body as Record<string, unknown> | undefined;
  if (!body) return null;

  const items = extractItems(body);
  if (items.length === 0) return null;

  const raw = items[0] as Record<string, unknown>;
  const expUsd = toNum(raw['expDlr'] ?? raw['expAmt'] ?? raw['exportAmt']);
  const impUsd = toNum(raw['impDlr'] ?? raw['impAmt'] ?? raw['importAmt']);
  const expKg  = toNum(raw['expWgt'] ?? raw['expKg'] ?? raw['exportWgt']);
  const impKg  = toNum(raw['impWgt'] ?? raw['impKg'] ?? raw['importWgt']);
  const hsName = String(raw['hsKrNm'] ?? raw['itemNm'] ?? raw['hsCdNm'] ?? '');
  const period = `${yr}-${mt}`;

  return {
    period,
    stat_type: 'item',
    hs_code: hsCd,
    hs_name: hsName || null,
    country_code: null,
    country_name: null,
    export_usd: expUsd,
    export_weight: expKg,
    import_usd: impUsd,
    import_weight: impKg,
    trade_balance: expUsd !== null && impUsd !== null ? expUsd - impUsd : null,
    data_source: '관세청 공공데이터포털',
  };
}

// ── Supabase 클라이언트 (trade_stats 전용 — NULL 포함 delete 처리) ──
function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

// NULL 컬럼이 포함된 UNIQUE 제약 우회: 기간+유형 단위로 먼저 삭제 후 삽입
async function deleteAndInsert(
  rows: TradeRow[],
  period: string,
  statType: 'country' | 'item'
): Promise<void> {
  const sb = getSupabase();
  if (!sb) {
    console.warn('[db] env missing — trade_statistics 저장 스킵');
    return;
  }
  const { error: delErr } = await sb
    .from('trade_statistics')
    .delete()
    .eq('period', period)
    .eq('stat_type', statType);
  if (delErr) console.warn(`[db] delete ${statType} rows:`, delErr.message);

  const { error: insErr } = await sb.from('trade_statistics').insert(rows as never[]);
  if (insErr) throw new Error(`[db] trade_statistics insert failed: ${insErr.message}`);
  console.log(`[db] trade_statistics ← ${rows.length} ${statType} rows (${period})`);
}

// ── 메인 collect 함수 ─────────────────────────────────────────────────
export async function collect(): Promise<CollectorResult> {
  const result: CollectorResult = { section: 'trade', data: [] };
  const apiKey = process.env.DATA_GO_KR_API_KEY;
  if (!apiKey) {
    console.error('[trade_stats] DATA_GO_KR_API_KEY 미설정 — 수집 스킵');
    result.data.push({
      data_type: 'trade_stat', data_key: 'config_error',
      data_value: {}, source: '관세청', is_complete: false,
      error_message: 'DATA_GO_KR_API_KEY not set',
    });
    return result;
  }

  const periodStr = parsePeriodArg();
  const yr = periodStr.slice(0, 4);
  const mt = periodStr.slice(4, 6);
  const period = `${yr}-${mt}`;
  console.log(`[trade_stats] 수집 기간: ${period}`);

  const countryRows: TradeRow[] = [];
  const itemRows:    TradeRow[] = [];

  // ── A: 국가별 수집 ────────────────────────────────────────────────
  for (const country of TARGET_COUNTRIES) {
    await sleep(DELAY_MS);
    try {
      const row = await fetchCountryStats(yr, mt, country.code, apiKey);
      if (row) {
        countryRows.push(row);
        result.data.push({
          data_type: 'trade_stat', data_key: `country_${country.code}_${periodStr}`,
          data_value: row, source: '관세청 공공데이터포털', is_complete: true,
        });
        const exp = row.export_usd !== null ? `$${(row.export_usd / 1e6).toFixed(0)}M` : 'N/A';
        console.log(`  ✅ ${country.name}(${country.code}): 수출 ${exp}`);
      } else {
        console.log(`  ⚠️ ${country.name}(${country.code}): 데이터 없음`);
        result.data.push({
          data_type: 'trade_stat', data_key: `country_${country.code}_${periodStr}`,
          data_value: {}, source: '관세청', is_complete: false, error_message: 'no data',
        });
      }
    } catch (e) {
      const msg = (e as Error).message;
      console.log(`  ⚠️ ${country.name}(${country.code}) 실패: ${msg}`);
      result.data.push({
        data_type: 'trade_stat', data_key: `country_${country.code}_error`,
        data_value: {}, source: '관세청', is_complete: false, error_message: msg,
      });
    }
  }

  // ── B: 품목별 수집 ────────────────────────────────────────────────
  for (const hs of TARGET_HS_CHAPTERS) {
    await sleep(DELAY_MS);
    try {
      const row = await fetchItemStats(yr, mt, hs.code, apiKey);
      if (row) {
        itemRows.push(row);
        result.data.push({
          data_type: 'trade_stat', data_key: `item_hs${hs.code}_${periodStr}`,
          data_value: row, source: '관세청 공공데이터포털', is_complete: true,
        });
        const exp = row.export_usd !== null ? `$${(row.export_usd / 1e6).toFixed(0)}M` : 'N/A';
        console.log(`  ✅ HS${hs.code} ${hs.name}: 수출 ${exp}`);
      } else {
        console.log(`  ⚠️ HS${hs.code} ${hs.name}: 데이터 없음`);
        result.data.push({
          data_type: 'trade_stat', data_key: `item_hs${hs.code}_${periodStr}`,
          data_value: {}, source: '관세청', is_complete: false, error_message: 'no data',
        });
      }
    } catch (e) {
      const msg = (e as Error).message;
      console.log(`  ⚠️ HS${hs.code} 실패: ${msg}`);
      result.data.push({
        data_type: 'trade_stat', data_key: `item_hs${hs.code}_error`,
        data_value: {}, source: '관세청', is_complete: false, error_message: msg,
      });
    }
  }

  // ── DB 저장 ──────────────────────────────────────────────────────
  if (countryRows.length > 0) {
    await deleteAndInsert(countryRows, period, 'country').catch(e =>
      console.warn('[trade_stats] country 저장 실패:', (e as Error).message)
    );
  }
  if (itemRows.length > 0) {
    await deleteAndInsert(itemRows, period, 'item').catch(e =>
      console.warn('[trade_stats] item 저장 실패:', (e as Error).message)
    );
  }

  const ok = result.data.filter(d => d.is_complete).length;
  console.log(`\n✅ trade_stats: ${ok}/${result.data.length}개 수집 완료 (${period})`);
  return result;
}

if (require.main === module) {
  collect().catch(console.error);
}
