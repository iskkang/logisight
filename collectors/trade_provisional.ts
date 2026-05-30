// collectors/trade_provisional.ts
// 관세청 공공데이터포털 OpenAPI — 10일 단위 수출·수입 잠정치 수집기
// 수출: https://apis.data.go.kr/1220000/cntyMmUtPrviExpAcrs/getCntyMmUtPrviExpAcrs
// 수입: https://apis.data.go.kr/1220000/cntyMmUtPrviImpAcrs/getCntyMmUtPrviImpAcrs
// 대상 테이블: trade_statistics (stat_type='provisional_exp'|'provisional_imp')
// 금액 단위: API 응답은 천 달러 → DB 저장 시 * 1000 변환

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

const EXP_URL = 'https://apis.data.go.kr/1220000/cntyMmUtPrviExpAcrs/getCntyMmUtPrviExpAcrs';
const IMP_URL = 'https://apis.data.go.kr/1220000/cntyMmUtPrviImpAcrs/getCntyMmUtPrviImpAcrs';

// ── 국가 매핑 상수 (수출·수입이 다름) ────────────────────────────────────────
const EXP_COUNTRY_MAP: Record<string, { code: string; name: string }> = {
  itemUsdAmt00: { code: 'ALL', name: '전체' },
  itemUsdAmt01: { code: 'CN',  name: '중국' },
  itemUsdAmt02: { code: 'US',  name: '미국' },
  itemUsdAmt03: { code: 'EU',  name: '유럽연합' },
  itemUsdAmt04: { code: 'VN',  name: '베트남' },
  itemUsdAmt05: { code: 'HK',  name: '홍콩' },
  itemUsdAmt06: { code: 'JP',  name: '일본' },
  itemUsdAmt07: { code: 'TW',  name: '대만' },
  itemUsdAmt08: { code: 'IN',  name: '인도' },
  itemUsdAmt09: { code: 'SG',  name: '싱가포르' },
  itemUsdAmt10: { code: 'MY',  name: '말레이시아' },
};

const IMP_COUNTRY_MAP: Record<string, { code: string; name: string }> = {
  itemUsdAmt00: { code: 'ALL', name: '전체' },
  itemUsdAmt01: { code: 'CN',  name: '중국' },
  itemUsdAmt02: { code: 'US',  name: '미국' },
  itemUsdAmt03: { code: 'EU',  name: '유럽연합' },
  itemUsdAmt04: { code: 'JP',  name: '일본' },
  itemUsdAmt05: { code: 'VN',  name: '베트남' },
  itemUsdAmt06: { code: 'AU',  name: '호주' },
  itemUsdAmt07: { code: 'TW',  name: '대만' },
  itemUsdAmt08: { code: 'SA',  name: '사우디아라비아' },
  itemUsdAmt09: { code: 'RU',  name: '러시아연방' },
  itemUsdAmt10: { code: 'MY',  name: '말레이시아' },
};

interface TradeProvRow {
  period: string;
  stat_type: 'provisional_exp' | 'provisional_imp';
  hs_code: null;
  hs_name: null;
  country_code: string;
  country_name: string;
  export_usd: number | null;
  export_weight: null;
  import_usd: number | null;
  import_weight: null;
  trade_balance: null;
  data_source: string;
  priod_dt: string;
  direction: string;
}

// ── XML 파싱 헬퍼 (외부 의존성 없음) ─────────────────────────────────────────
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

// API 단위: 천 달러 → 달러 변환
function toUsd(val: string | undefined): number | null {
  if (!val || val.trim() === '') return null;
  const n = Number(val.replace(/,/g, ''));
  return isNaN(n) ? null : n * 1000;
}

function getCurrentPeriod(): string {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function parsePeriodArg(): string {
  const arg = process.argv.find(a => a.startsWith('--period='));
  if (arg) {
    const p = arg.split('=')[1];
    if (/^\d{6}$/.test(p)) return p;
    console.warn(`[trade_provisional] 잘못된 --period 형식: ${p}, 당월로 대체`);
  }
  return getCurrentPeriod();
}

// ── API 호출 — 1개월 기간에 1~3개 item 반환 (01~10, 01~20, 01~말일) ──────────
async function fetchProvApi(
  url: string,
  yymm: string,
  apiKey: string
): Promise<Record<string, string>[]> {
  const params = new URLSearchParams({ strtYymm: yymm, endYymm: yymm });
  const urlStr = `${url}?serviceKey=${apiKey}&${params.toString()}`;

  const res = await fetch(urlStr, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) {
    const body = await res.text();
    console.error(`[trade_provisional] HTTP ${res.status}:\n${body}`);
    throw new Error(`HTTP ${res.status}`);
  }

  const xmlText = await res.text();
  const items = parseXmlItems(xmlText);
  if (items.length === 0) {
    console.log(`[trade_provisional] raw XML (first 2000 chars):\n${xmlText.slice(0, 2000)}`);
  }
  return items;
}

// ── XML item 하나를 국가별 행 배열로 변환 ──────────────────────────────────────
function expandItem(
  item: Record<string, string>,
  statType: 'provisional_exp' | 'provisional_imp',
  direction: 'exp' | 'imp',
  countryMap: Record<string, { code: string; name: string }>,
  period: string
): TradeProvRow[] {
  const priodDt = item['priodDt'] ?? '';
  return Object.entries(countryMap).map(([field, country]) => ({
    period,
    stat_type: statType,
    hs_code: null,
    hs_name: null,
    country_code: country.code,
    country_name: country.name,
    export_usd: direction === 'exp' ? toUsd(item[field]) : null,
    export_weight: null,
    import_usd: direction === 'imp' ? toUsd(item[field]) : null,
    import_weight: null,
    trade_balance: null,
    data_source: '관세청 10일단위잠정치',
    priod_dt: priodDt,
    direction,
  }));
}

// ── Supabase — delete-then-insert per (period, stat_type, priod_dt) ──────────
function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

async function deleteAndInsert(rows: TradeProvRow[], period: string): Promise<void> {
  const sb = getSupabase();
  if (!sb) {
    console.warn('[db] env missing — trade_statistics 저장 스킵');
    return;
  }

  // 고유한 (stat_type, priod_dt) 조합별 삭제
  const keys = [...new Set(rows.map(r => `${r.stat_type}|${r.priod_dt}`))];
  for (const key of keys) {
    const [statType, priodDt] = key.split('|');
    const { error } = await sb
      .from('trade_statistics')
      .delete()
      .eq('period', period)
      .eq('stat_type', statType)
      .eq('priod_dt', priodDt);
    if (error) console.warn(`[db] delete (${statType}, ${priodDt}):`, error.message);
  }

  const { error: insErr } = await sb.from('trade_statistics').insert(rows as never[]);
  if (insErr) throw new Error(`[db] insert failed: ${insErr.message}`);
  console.log(`[db] trade_statistics ← ${rows.length} provisional rows (${period})`);
}

// ── 메인 ──────────────────────────────────────────────────────────────────────
export async function collect(): Promise<CollectorResult> {
  const result: CollectorResult = { section: 'trade', data: [] };
  const apiKey = process.env.DATA_GO_KR_API_KEY;
  if (!apiKey) {
    console.error('[trade_provisional] DATA_GO_KR_API_KEY 미설정 — 수집 스킵');
    result.data.push({
      data_type: 'trade_provisional', data_key: 'config_error',
      data_value: {}, source: '관세청', is_complete: false,
      error_message: 'DATA_GO_KR_API_KEY not set',
    });
    return result;
  }

  const periodStr = parsePeriodArg();
  const period = `${periodStr.slice(0, 4)}-${periodStr.slice(4, 6)}`;
  console.log(`[trade_provisional] 수집 기간: ${period}`);

  const allRows: TradeProvRow[] = [];

  // 수출 잠정치
  try {
    const expItems = await fetchProvApi(EXP_URL, periodStr, apiKey);
    for (const item of expItems) {
      allRows.push(...expandItem(item, 'provisional_exp', 'exp', EXP_COUNTRY_MAP, period));
    }
    const priodList = expItems.map(i => i['priodDt']).join(', ');
    console.log(`  ✅ 수출 잠정치: ${expItems.length}개 기간 (${priodList})`);
    result.data.push({
      data_type: 'trade_provisional', data_key: `exp_${periodStr}`,
      data_value: { items: expItems.length, period },
      source: '관세청 10일단위잠정치',
      is_complete: expItems.length > 0,
    });
  } catch (e) {
    const msg = (e as Error).message;
    console.error(`  ❌ 수출 잠정치 실패: ${msg}`);
    result.data.push({
      data_type: 'trade_provisional', data_key: `exp_${periodStr}_error`,
      data_value: {}, source: '관세청', is_complete: false, error_message: msg,
    });
  }

  // 수입 잠정치
  try {
    const impItems = await fetchProvApi(IMP_URL, periodStr, apiKey);
    for (const item of impItems) {
      allRows.push(...expandItem(item, 'provisional_imp', 'imp', IMP_COUNTRY_MAP, period));
    }
    const priodList = impItems.map(i => i['priodDt']).join(', ');
    console.log(`  ✅ 수입 잠정치: ${impItems.length}개 기간 (${priodList})`);
    result.data.push({
      data_type: 'trade_provisional', data_key: `imp_${periodStr}`,
      data_value: { items: impItems.length, period },
      source: '관세청 10일단위잠정치',
      is_complete: impItems.length > 0,
    });
  } catch (e) {
    const msg = (e as Error).message;
    console.error(`  ❌ 수입 잠정치 실패: ${msg}`);
    result.data.push({
      data_type: 'trade_provisional', data_key: `imp_${periodStr}_error`,
      data_value: {}, source: '관세청', is_complete: false, error_message: msg,
    });
  }

  if (allRows.length > 0) {
    await deleteAndInsert(allRows, period).catch(e =>
      console.warn('[trade_provisional] 저장 실패:', (e as Error).message)
    );
  }

  const ok = result.data.filter(d => d.is_complete).length;
  console.log(`\n✅ trade_provisional: ${ok}/${result.data.length} 완료 (${period})`);
  return result;
}

if (require.main === module) {
  collect().catch(console.error);
}
