// collectors/trade_stats.ts
// 관세청 공공데이터포털 OpenAPI — 한국 국가별 무역통계 수집기
// 엔드포인트: https://apis.data.go.kr/1220000/nationtrade/getNationtradeList
// 응답 형식: XML (type 파라미터 없음)
// 대상 테이블: trade_statistics (stat_type='country' 고정)

import fs from 'fs';
import path from 'path';
import ws from 'ws';
// @ts-ignore — Node 20 lacks a native WebSocket
globalThis.WebSocket = ws as never;

import { createClient } from '@supabase/supabase-js';
import type { CollectorResult } from './types';

// .env.local 로드 (로컬 실행 시; CI는 환경변수 주입이므로 덮어쓰지 않음)
function loadEnvLocal() {
  const envPath = path.resolve(__dirname, '../.env.local');
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, 'utf-8').split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}
loadEnvLocal();

const API_URL = 'https://apis.data.go.kr/1220000/nationtrade/getNationtradeList';
const DELAY_MS = 200; // data.go.kr 개발계정 레이트 리밋 준수

// 한국 주요 교역 상대국 (ISO 3166-1 alpha-2)
const TARGET_COUNTRIES = [
  // 아시아·오세아니아
  { code: 'CN', name: '중국' },
  { code: 'JP', name: '일본' },
  { code: 'VN', name: '베트남' },
  { code: 'TW', name: '대만' },
  { code: 'HK', name: '홍콩' },
  { code: 'SG', name: '싱가포르' },
  { code: 'MY', name: '말레이시아' },
  { code: 'IN', name: '인도' },
  { code: 'TH', name: '태국' },
  { code: 'ID', name: '인도네시아' },
  { code: 'PH', name: '필리핀' },
  { code: 'BD', name: '방글라데시' },
  { code: 'PK', name: '파키스탄' },
  { code: 'KH', name: '캄보디아' },
  { code: 'MM', name: '미얀마' },
  { code: 'LK', name: '스리랑카' },
  { code: 'AU', name: '호주' },
  { code: 'NZ', name: '뉴질랜드' },
  // 중동
  { code: 'AE', name: 'UAE' },
  { code: 'SA', name: '사우디아라비아' },
  { code: 'TR', name: '터키' },
  { code: 'IR', name: '이란' },
  { code: 'IQ', name: '이라크' },
  { code: 'IL', name: '이스라엘' },
  { code: 'OM', name: '오만' },
  { code: 'KW', name: '쿠웨이트' },
  { code: 'QA', name: '카타르' },
  { code: 'BH', name: '바레인' },
  // 유럽
  { code: 'DE', name: '독일' },
  { code: 'NL', name: '네덜란드' },
  { code: 'PL', name: '폴란드' },
  { code: 'FR', name: '프랑스' },
  { code: 'GB', name: '영국' },
  { code: 'IT', name: '이탈리아' },
  { code: 'ES', name: '스페인' },
  { code: 'HU', name: '헝가리' },
  { code: 'CZ', name: '체코' },
  { code: 'SK', name: '슬로바키아' },
  // 중앙아시아·러시아
  { code: 'KZ', name: '카자흐스탄' },
  // 북미
  { code: 'US', name: '미국' },
  { code: 'CA', name: '캐나다' },
  { code: 'MX', name: '멕시코' },
  // 중남미
  { code: 'BR', name: '브라질' },
  { code: 'CL', name: '칠레' },
  { code: 'PE', name: '페루' },
  // 아프리카
  { code: 'ZA', name: '남아프리카공화국' },
  { code: 'NG', name: '나이지리아' },
  { code: 'EG', name: '이집트' },
  { code: 'MA', name: '모로코' },
];

interface TradeRow {
  period: string;
  stat_type: 'country';
  hs_code: null;
  hs_name: null;
  country_code: string;
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

function getPrevPeriod(): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function parsePeriodArg(): string {
  const arg = process.argv.find(a => a.startsWith('--period='));
  if (arg) {
    const p = arg.split('=')[1];
    if (/^\d{6}$/.test(p)) return p;
    console.warn(`[trade_stats] 잘못된 --period 형식: ${p}, 전월로 대체`);
  }
  return getPrevPeriod();
}

/**
 * nationtrade API 의 expDlr/impDlr 은 **이미 달러**다 → 변환하지 않는다.
 *
 * ★ 여기에 ×1000 을 넣지 말 것. 잠정 수집기(trade_provisional.ts)가 ×1000 하는 것을
 *   보고 "통일"하면 이쪽이 1000배 부풀려진다. API 가 달라서 단위가 다른 것이다.
 *
 * 2026-08-14 실측으로 확인한 근거:
 *   nationtrade  2026-06 중국 expDlr = 20,002,319,069  → $20.0B. 그대로 달러다.
 *   235개국 합계 = 101,956,159,193 → 한국 6월 수출 $102.0B.
 *   같은 달 잠정 API 01~30 = 101,956,159 (천 달러) 와 정확히 1000배 관계.
 *
 * 한국 월간 수출이 "$50B 대여야 정상"이라는 기준으로 판단하지 말 것 —— 실제 관세청
 * 값이 $102B 이고, $50B 에 맞추려 하면 정상 데이터를 절반으로 깎게 된다.
 */
export function toNum(val: string | undefined): number | null {
  if (!val || val.trim() === '') return null;
  const n = Number(val.replace(/,/g, ''));
  return isNaN(n) ? null : n;
}

// ── XML 파싱 헬퍼 (외부 의존성 없음) ────────────────────────────────────
function xmlTagValue(xml: string, tag: string): string {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));
  return m ? m[1].trim() : '';
}

function parseXmlItems(xmlText: string): Record<string, string>[] {
  const itemsBlock = xmlTagValue(xmlText, 'items');
  if (!itemsBlock) return [];
  const items: Record<string, string>[] = [];
  for (const m of itemsBlock.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const obj: Record<string, string> = {};
    for (const t of m[1].matchAll(/<([^/>\s]+)[^>]*>([^<]*)<\/[^>]+>/g)) {
      obj[t[1]] = t[2].trim();
    }
    items.push(obj);
  }
  return items;
}

// ── API 단일 호출 (수출+수입 통합 응답) ──────────────────────────────────
// nationtrade API: strtYymm/endYymm (YYYYMM), cntyCd optional — imexTpcd 없음
async function fetchNationTrade(
  yymm: string,
  cntyCd: string,
  apiKey: string
): Promise<Record<string, string> | null> {
  // data.go.kr 키는 이미 URL인코딩된 상태 — serviceKey만 raw로 붙임
  const params = new URLSearchParams({
    strtYymm: yymm, endYymm: yymm,
    cntyCd, numOfRows: '5',
  });
  const urlStr = `${API_URL}?serviceKey=${apiKey}&${params.toString()}`;

  const res = await fetch(urlStr, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) {
    const body = await res.text();
    console.error(`[trade_stats] HTTP ${res.status} (${cntyCd}):\n${body}`);
    throw new Error(`HTTP ${res.status}`);
  }

  const xmlText = await res.text();
  const items = parseXmlItems(xmlText);
  if (items.length === 0 && cntyCd === 'CN') {
    console.log(`[trade_stats] raw XML (CN, first 3000 chars):\n${xmlText.slice(0, 3000)}`);
  }
  return items.length > 0 ? items[0] : null;
}

// ── 국가 1개 — 단일 호출로 수출+수입 동시 취득 ────────────────────────────
async function fetchCountryRow(
  yymm: string,
  cntyCd: string,
  countryName: string,
  apiKey: string
): Promise<TradeRow | null> {
  const raw = await fetchNationTrade(yymm, cntyCd, apiKey);
  if (!raw) return null;

  // 응답 필드명 후보 (API 버전에 따라 다를 수 있음)
  const expUsd = toNum(raw['expDlr'] ?? raw['expAmt']);
  const expKg  = toNum(raw['expWgt'] ?? raw['expWeight']);
  const impUsd = toNum(raw['impDlr'] ?? raw['impAmt']);
  const impKg  = toNum(raw['impWgt'] ?? raw['impWeight']);
  const resolvedName = raw['cntyCdNm'] ?? raw['cntyNm'] ?? raw['cntyKrNm'] ?? countryName;

  const yr = yymm.slice(0, 4);
  const mt = yymm.slice(4, 6);
  return {
    period: `${yr}-${mt}`,
    stat_type: 'country',
    hs_code: null,
    hs_name: null,
    country_code: cntyCd,
    country_name: resolvedName,
    export_usd: expUsd,
    export_weight: expKg,
    import_usd: impUsd,
    import_weight: impKg,
    trade_balance: expUsd !== null && impUsd !== null ? expUsd - impUsd : null,
    data_source: '관세청 공공데이터포털',
  };
}

// ── Supabase — delete-then-insert (NULL 포함 UNIQUE 제약 우회) ─────────
function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

async function deleteAndInsert(rows: TradeRow[], period: string): Promise<void> {
  const sb = getSupabase();
  if (!sb) {
    console.warn('[db] env missing — trade_statistics 저장 스킵');
    return;
  }
  const { error: delErr } = await sb
    .from('trade_statistics')
    .delete()
    .eq('period', period)
    .eq('stat_type', 'country');
  if (delErr) console.warn('[db] delete country rows:', delErr.message);

  const { error: insErr } = await sb.from('trade_statistics').insert(rows as never[]);
  if (insErr) throw new Error(`[db] trade_statistics insert failed: ${insErr.message}`);
  console.log(`[db] trade_statistics ← ${rows.length} country rows (${period})`);
}

// ── 메인 ─────────────────────────────────────────────────────────────
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

  const periodStr = parsePeriodArg();  // YYYYMM
  const period = `${periodStr.slice(0, 4)}-${periodStr.slice(4, 6)}`;
  console.log(`[trade_stats] 수집 기간: ${period}`);

  const rows: TradeRow[] = [];

  for (const country of TARGET_COUNTRIES) {
    await sleep(DELAY_MS);
    try {
      const row = await fetchCountryRow(periodStr, country.code, country.name, apiKey);
      if (row) {
        rows.push(row);
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

  if (rows.length > 0) {
    await deleteAndInsert(rows, period).catch(e =>
      console.warn('[trade_stats] 저장 실패:', (e as Error).message)
    );
  }

  const ok = result.data.filter(d => d.is_complete).length;
  console.log(`\n✅ trade_stats: ${ok}/${result.data.length}개 수집 완료 (${period})`);
  return result;
}

if (require.main === module) {
  collect().catch(console.error);
}
