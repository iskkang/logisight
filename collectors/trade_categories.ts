// collectors/trade_categories.ts
// 관세청 공공데이터포털 OpenAPI — 추가 무역통계 4종 수집기 (전체 국가)
//   1) 대륙별 수출입실적(GW)        15101630  continenttradet/getContinenttradeList
//   2) 품목별 수출입실적(GW)        15101609  Itemtrade/getItemtradeList        (hsSgn 필수)
//   3) 품목별 국가별 수출입실적(GW) 15100475  nitemtrade/getNitemtradeList      (cntyCd 필수)
//   4) 신성질별 국가별 수출입실적(GW) 15101607 nnewtempertrade/getNnewtempertradeList (imexTpcd+cntyCd 필수)
// 대상 테이블: trade_statistics — 기존 컬럼 재사용, stat_type으로 구분
//   continent | item | item_country | newnature
// 용도: 보고서·검증용 reference (forecast 파이프라인은 provisional_exp만 소비)
//
// 국가 범위: nationtrade(cntyCd 없이) 응답에서 전체 교역국 코드(~232개)를 동적 취득.
// 단일 응답 최대 행수가 개발계정 상한(10,000) 이내이므로 페이지네이션 불필요.

import fs from 'fs';
import path from 'path';
import ws from 'ws';
// @ts-ignore — Node 20 lacks a native WebSocket
globalThis.WebSocket = ws as never;

import { createClient } from '@supabase/supabase-js';
import type { CollectorResult } from './types';

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

const BASE = 'https://apis.data.go.kr/1220000';
const NATION_URL        = `${BASE}/nationtrade/getNationtradeList`;
const ITEM_URL          = `${BASE}/Itemtrade/getItemtradeList`;
const NITEM_URL         = `${BASE}/nitemtrade/getNitemtradeList`;
const CONTINENT_URL     = `${BASE}/continenttradet/getContinenttradeList`;
const NEWNATURE_URL     = `${BASE}/nnewtempertrade/getNnewtempertradeList`;
const DELAY_MS  = 200;       // data.go.kr 개발계정 레이트 리밋 준수
const NUM_ROWS  = '9900';    // 개발계정 단일호출 상한(10,000) 이내 — 초과 시 truncated 경고

// HS 2자리 챕터 01~99 (품목별 전체). 일부는 빈 응답 — graceful skip.
const ALL_HS_CHAPTERS = Array.from({ length: 99 }, (_, i) =>
  String(i + 1).padStart(2, '0')
);

// trade_statistics 행 (컬럼 그대로) — 컬럼 미사용 필드는 null
interface TradeRow {
  period: string;
  stat_type: 'continent' | 'item' | 'item_country' | 'newnature';
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
    console.warn(`[trade_categories] 잘못된 --period 형식: ${p}, 전월로 대체`);
  }
  return getPrevPeriod();
}

function toNum(val: string | undefined): number | null {
  if (val === undefined || val.trim() === '' || val.trim() === '-') return null;
  const n = Number(val.replace(/,/g, ''));
  return isNaN(n) ? null : n;
}

// ── XML 파싱 헬퍼 (trade_stats.ts와 동일 — 외부 의존성 없음) ─────────────────
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

async function fetchItems(
  url: string,
  params: Record<string, string>,
  apiKey: string
): Promise<Record<string, string>[]> {
  // data.go.kr 키는 이미 URL인코딩된 상태 — serviceKey만 raw로 붙임
  const qs = new URLSearchParams({ numOfRows: NUM_ROWS, ...params });
  const urlStr = `${url}?serviceKey=${apiKey}&${qs.toString()}`;
  const res = await fetch(urlStr, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`HTTP ${res.status}: ${body.slice(0, 120)}`);
  }
  const xmlText = await res.text();
  const code = xmlTagValue(xmlText, 'resultCode');
  if (code && code !== '00') {
    throw new Error(`API ${code}: ${xmlTagValue(xmlText, 'resultMsg')}`);
  }
  const items = parseXmlItems(xmlText);
  if (items.length === Number(NUM_ROWS)) {
    console.warn(`  ⚠️ truncated at ${NUM_ROWS} rows: ${url} ${JSON.stringify(params)}`);
  }
  return items;
}

const period6to7 = (yymm: string) => `${yymm.slice(0, 4)}-${yymm.slice(4, 6)}`;

// ── 전체 교역국 코드 동적 취득 (nationtrade, cntyCd 없이) ─────────────────────
async function fetchCountryCodes(yymm: string, apiKey: string): Promise<string[]> {
  const items = await fetchItems(
    NATION_URL, { strtYymm: yymm, endYymm: yymm }, apiKey
  );
  const codes = new Set<string>();
  for (const it of items) {
    const c = (it['cntyCd'] ?? it['statCd'] ?? '').trim();
    if (/^[A-Z]{2}$/.test(c)) codes.add(c);
  }
  return [...codes].sort();
}

// ── 1) 대륙별 — 기간만, 1회 호출 (대륙 ~6행) ─────────────────────────────────
async function collectContinent(yymm: string, apiKey: string): Promise<TradeRow[]> {
  const items = await fetchItems(CONTINENT_URL, { strtYymm: yymm, endYymm: yymm }, apiKey);
  const period = period6to7(yymm);
  return items
    .filter(it => (it['statCdCntnKor1'] ?? '') !== '' && it['year'] !== '총계')
    .map(it => ({
      period,
      stat_type: 'continent' as const,
      hs_code: null,
      hs_name: null,
      country_code: it['statCd'] ?? null,          // 대륙 코드(10/20/…)를 코드 컬럼에 보관
      country_name: it['statCdCntnKor1'] ?? null,  // 대륙명(아시아/중동/…)
      export_usd: toNum(it['expDlr']),
      export_weight: null,                          // 대륙별 API는 중량 대신 건수(expCnt) 제공 — 미저장
      import_usd: toNum(it['impDlr']),
      import_weight: null,
      trade_balance: toNum(it['balPayments']),
      data_source: '관세청 대륙별 수출입실적',
    }));
}

// ── 2) 품목별 — HS 2자리 챕터(01~99) 전체, 10자리 품목행 저장 ──────────────────
async function collectItem(yymm: string, apiKey: string): Promise<TradeRow[]> {
  const period = period6to7(yymm);
  const rows: TradeRow[] = [];
  let fails = 0;
  for (const chapter of ALL_HS_CHAPTERS) {
    await sleep(DELAY_MS);
    let items: Record<string, string>[];
    try {
      items = await fetchItems(ITEM_URL, { strtYymm: yymm, endYymm: yymm, hsSgn: chapter }, apiKey);
    } catch (e) {
      fails++; continue; // 빈/없는 챕터 또는 일시 오류 — 건너뜀
    }
    for (const it of items) {
      const hs = it['hsCode'] ?? '';
      if (hs === '' || hs === '-') continue;
      rows.push({
        period, stat_type: 'item',
        hs_code: hs, hs_name: it['statKor'] ?? null,
        country_code: null, country_name: null,
        export_usd: toNum(it['expDlr']), export_weight: toNum(it['expWgt']),
        import_usd: toNum(it['impDlr']), import_weight: toNum(it['impWgt']),
        trade_balance: toNum(it['balPayments']),
        data_source: '관세청 품목별 수출입실적',
      });
    }
  }
  if (fails) console.log(`    (품목별: ${fails}개 챕터 빈/오류 스킵)`);
  return rows;
}

// ── 3) 품목별 국가별 — 전체 교역국, 각국 전체 품목 ───────────────────────────
async function collectItemCountry(
  yymm: string, apiKey: string, countries: string[]
): Promise<TradeRow[]> {
  const period = period6to7(yymm);
  const rows: TradeRow[] = [];
  let fails = 0;
  for (const cnty of countries) {
    await sleep(DELAY_MS);
    let items: Record<string, string>[];
    try {
      items = await fetchItems(NITEM_URL, { strtYymm: yymm, endYymm: yymm, cntyCd: cnty }, apiKey);
    } catch (e) {
      fails++; continue;
    }
    for (const it of items) {
      const hs = it['hsCd'] ?? '';
      if (hs === '' || hs === '-') continue; // 총계 행 제외
      rows.push({
        period, stat_type: 'item_country',
        hs_code: hs, hs_name: it['statKor'] ?? null,
        country_code: cnty, country_name: it['statCdCntnKor1'] ?? null,
        export_usd: toNum(it['expDlr']), export_weight: toNum(it['expWgt']),
        import_usd: toNum(it['impDlr']), import_weight: toNum(it['impWgt']),
        trade_balance: toNum(it['balPayments']),
        data_source: '관세청 품목별 국가별 수출입실적',
      });
    }
  }
  if (fails) console.log(`    (품목별국가별: ${fails}개국 오류 스킵)`);
  return rows;
}

// ── 4) 신성질별 국가별 — 전체 교역국×수출입, (국가,성질코드)별 병합 ───────────
async function collectNewNature(
  yymm: string, apiKey: string, countries: string[]
): Promise<TradeRow[]> {
  const period = period6to7(yymm);
  const merged = new Map<string, TradeRow>();
  let fails = 0;
  for (const cnty of countries) {
    for (const dir of [{ code: '1', f: 'export' }, { code: '2', f: 'import' }] as const) {
      await sleep(DELAY_MS);
      let items: Record<string, string>[];
      try {
        items = await fetchItems(
          NEWNATURE_URL,
          { strtYymm: yymm, endYymm: yymm, imexTpcd: dir.code, cntyCd: cnty },
          apiKey
        );
      } catch (e) {
        fails++; continue;
      }
      for (const it of items) {
        const gods = it['godsCd'] ?? '';
        if (gods === '' || gods === '-') continue;
        const key = `${cnty}|${gods}`;
        let row = merged.get(key);
        if (!row) {
          row = {
            period, stat_type: 'newnature',
            hs_code: gods,                  // 신성질 분류코드(8자리)
            hs_name: it['godsKor'] ?? null, // 신성질 분류명
            country_code: cnty, country_name: it['statCdCntnKor1'] ?? null,
            export_usd: null, export_weight: null,
            import_usd: null, import_weight: null,
            trade_balance: null,
            data_source: '관세청 신성질별 국가별 수출입실적',
          };
          merged.set(key, row);
        }
        if (dir.f === 'export') {
          row.export_usd = toNum(it['dlr']); row.export_weight = toNum(it['wgt']);
        } else {
          row.import_usd = toNum(it['dlr']); row.import_weight = toNum(it['wgt']);
        }
        if (row.export_usd !== null && row.import_usd !== null) {
          row.trade_balance = row.export_usd - row.import_usd;
        }
      }
    }
  }
  if (fails) console.log(`    (신성질별: ${fails}개 콜 오류 스킵)`);
  return [...merged.values()];
}

// ── Supabase — stat_type 단위 delete-then-insert (NULL UNIQUE 우회) ─────────
function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

async function deleteAndInsert(rows: TradeRow[], period: string, statType: string): Promise<void> {
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
  if (delErr) console.warn(`[db] delete ${statType}:`, delErr.message);

  // 대량 행 — 1000개씩 청크 삽입
  for (let i = 0; i < rows.length; i += 1000) {
    const chunk = rows.slice(i, i + 1000);
    const { error } = await sb.from('trade_statistics').insert(chunk as never[]);
    if (error) throw new Error(`[db] insert ${statType} failed: ${error.message}`);
  }
  console.log(`[db] trade_statistics ← ${rows.length} ${statType} rows (${period})`);
}

// ── 메인 ─────────────────────────────────────────────────────────────────────
export async function collect(): Promise<CollectorResult> {
  const result: CollectorResult = { section: 'trade', data: [] };
  const apiKey = process.env.DATA_GO_KR_API_KEY;
  if (!apiKey) {
    console.error('[trade_categories] DATA_GO_KR_API_KEY 미설정 — 수집 스킵');
    result.data.push({
      data_type: 'trade_category', data_key: 'config_error',
      data_value: {}, source: '관세청', is_complete: false,
      error_message: 'DATA_GO_KR_API_KEY not set',
    });
    return result;
  }

  const periodStr = parsePeriodArg();
  const period = period6to7(periodStr);
  console.log(`[trade_categories] 수집 기간: ${period}`);

  // 전체 교역국 코드 동적 취득 (item_country·newnature 공용)
  let countries: string[] = [];
  try {
    countries = await fetchCountryCodes(periodStr, apiKey);
    console.log(`[trade_categories] 교역국 ${countries.length}개국 취득`);
  } catch (e) {
    console.error(`[trade_categories] 국가목록 취득 실패: ${(e as Error).message}`);
  }

  const tasks: Array<{ key: string; label: string; fn: () => Promise<TradeRow[]> }> = [
    { key: 'continent',    label: '대륙별',          fn: () => collectContinent(periodStr, apiKey) },
    { key: 'item',         label: '품목별',          fn: () => collectItem(periodStr, apiKey) },
    { key: 'item_country', label: '품목별 국가별',   fn: () => collectItemCountry(periodStr, apiKey, countries) },
    { key: 'newnature',    label: '신성질별 국가별', fn: () => collectNewNature(periodStr, apiKey, countries) },
  ];

  for (const t of tasks) {
    try {
      const rows = await t.fn();
      if (rows.length > 0) {
        await deleteAndInsert(rows, period, t.key);
      }
      console.log(`  ✅ ${t.label}: ${rows.length}행`);
      result.data.push({
        data_type: 'trade_category', data_key: `${t.key}_${periodStr}`,
        data_value: { rows: rows.length, period },
        source: '관세청 공공데이터포털', is_complete: rows.length > 0,
      });
    } catch (e) {
      const msg = (e as Error).message;
      console.error(`  ❌ ${t.label} 실패: ${msg}`);
      result.data.push({
        data_type: 'trade_category', data_key: `${t.key}_${periodStr}_error`,
        data_value: {}, source: '관세청', is_complete: false, error_message: msg,
      });
    }
  }

  const ok = result.data.filter(d => d.is_complete).length;
  console.log(`\n✅ trade_categories: ${ok}/${result.data.length} 완료 (${period})`);
  return result;
}

if (require.main === module) {
  collect().catch(console.error);
}
