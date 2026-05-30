// collectors/freight_rates.ts
// 해양수산부 컨테이너 화물운임 공표정보 → freight_rates 테이블 upsert
//
// 실행: npx tsx collectors/freight_rates.ts
// 탐색: npx tsx collectors/freight_rates.ts --probe  (API 응답 필드 확인용)
// 건조: npx tsx collectors/freight_rates.ts --dry-run
//
// 환경변수 (.env.local):
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//   DATA_GO_KR_API_KEY  ← .env.local의 키는 이미 URL 인코딩됨 (재인코딩 금지)

import fs from 'fs';
import path from 'path';
import ws from 'ws';
// @ts-ignore — Node 20 lacks a native WebSocket
globalThis.WebSocket = ws as never;

import { createClient } from '@supabase/supabase-js';
import { XMLParser } from 'fast-xml-parser';
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

const BASE_URL = 'https://apis.data.go.kr/1192000/CychgFrghtOut4/Info4';

const IS_PROBE = process.argv.includes('--probe');
const IS_DRY   = process.argv.includes('--dry-run');

// 한국 POL 목록 (부산, 인천, 광양)
const KR_POLS = ['KRPUS', 'KRICN', 'KRGMP'];

const NUM_OF_ROWS = 1000;

// ── 날짜 헬퍼 ────────────────────────────────────────────────────────────────
function toYYYYMMDD(date: Date): string {
  return date.toISOString().slice(0, 10).replace(/-/g, '');
}

function yyyymmddToDate(s: string): string {
  if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  return s;
}

// ── 컨테이너 타입 변환 ────────────────────────────────────────────────────────
function resolveContainerType(cnd: string | number, std: string | number): string {
  const c = String(cnd).trim();
  const s = String(std).trim();
  if (c === '1' && s === '1') return '20DRY';
  if (c === '1' && s === '2') return '40DRY';
  if (c === '1' && s === '3') return '40HC';
  if ((c === '2' || c === '3') && s === '1') return '20RF';
  if ((c === '2' || c === '3') && s === '2') return '40RF';
  return `${c}_${s}`;
}

// ── is_featured 판별 ──────────────────────────────────────────────────────────
const FEATURED_POL = new Set(['KRPUS', 'KRICN']);
const FEATURED_POD_ORDER: Record<string, number> = {
  USLAX: 1, USNYC: 2, DEHAM: 3, NLRTM: 4,
  CNSHA: 5, CNNGB: 6, JPOSA: 7, VNSGN: 8,
};

function featuredProps(polCd: string, podCd: string): { is_featured: boolean; display_order: number } {
  if (FEATURED_POL.has(polCd) && podCd in FEATURED_POD_ORDER) {
    return { is_featured: true, display_order: FEATURED_POD_ORDER[podCd] };
  }
  return { is_featured: false, display_order: 0 };
}

// ── API 호출 (POL별, XML 응답) ────────────────────────────────────────────────
async function fetchPage(
  pol: string,
  pageNo: number,
  fromDate: string,
  toDate: string,
  apiKey: string,
): Promise<string> {
  // .env.local 키는 이미 URL 인코딩됨 → raw로 붙여야 이중 인코딩 방지
  const url = `${BASE_URL}?serviceKey=${apiKey}&shipngPrtCd=${pol}&pageNo=${pageNo}&numOfRows=${NUM_OF_ROWS}&annGb=v2&fermnDeFr=${fromDate}&fermnDeTo=${toDate}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} — ${pol} page ${pageNo}`);
  return res.text();
}

// ── XML 파싱 → 아이템 배열 ────────────────────────────────────────────────────
const parser = new XMLParser({ ignoreAttributes: false, parseTagValue: true });

function parseItems(xml: string): { items: any[]; totalCount: number } {
  const obj = parser.parse(xml);
  const body = obj?.response?.body ?? obj?.body ?? {};
  const totalCount = Number(body?.totalCount ?? 0);
  const raw = body?.items?.item ?? [];
  const items = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return { items, totalCount };
}

// ── 아이템 → freight_rates 행 매핑 ──────────────────────────────────────────
function mapItem(item: any, today: string): Record<string, any> | null {
  const imxprtSe = String(item.imxprtSe ?? '').trim();
  const polCd    = String(item.shipngPrtCd ?? '').trim().toUpperCase();
  const podCd    = String(item.landngPrtCd ?? '').trim().toUpperCase();
  if (!polCd || !podCd) return null;

  const polNm   = String(item.shipngPrtNm ?? '').trim() || null;
  const podNm   = String(item.landngPrtNm ?? '').trim() || null;
  const carrier = String(item.entrpsNm    ?? '').trim() || null;

  const containerType = resolveContainerType(
    item.contnCnd ?? '1',
    item.contnStdStndrd ?? '2',
  );

  const rateRaw = item.cychgOf ?? null;
  const rate    = rateRaw !== null ? Number(String(rateRaw).replace(/,/g, '')) : null;

  const validFrom = item.fermnDe
    ? yyyymmddToDate(String(item.fermnDe))
    : today;

  const sourceUpdatedAt = item.annDe
    ? yyyymmddToDate(String(item.annDe))
    : null;

  const annNo = String(item.annNo ?? '').trim();

  return {
    pol_code:          polCd,
    pol_name:          polNm,
    pod_code:          podCd,
    pod_name:          podNm,
    container_type:    containerType,
    rate_usd:          rate,
    currency:          'USD',
    carrier:           carrier,
    data_source:       'data.go.kr 화물운임공표',
    valid_from:        validFrom,
    source_updated_at: sourceUpdatedAt,
    ann_no:            annNo,
    imxprt_se:         imxprtSe,
    ...featuredProps(polCd, podCd),
  };
}

// ── 메인 수집 로직 ────────────────────────────────────────────────────────────
export async function collect(): Promise<CollectorResult> {
  const result: CollectorResult = { section: 'trade', data: [] };

  const apiKey     = process.env.DATA_GO_KR_API_KEY ?? '';
  const supabaseUrl = process.env.SUPABASE_URL ?? '';
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

  if (!apiKey) {
    console.error('❌ DATA_GO_KR_API_KEY 환경변수가 없습니다.');
    result.data.push({
      data_type: 'freight_rate', data_key: 'config_error',
      data_value: {}, source: 'data.go.kr', is_complete: false,
      error_message: 'DATA_GO_KR_API_KEY not set',
    });
    return result;
  }
  if (!supabaseUrl || !serviceKey) {
    console.error('❌ SUPABASE_URL 또는 SUPABASE_SERVICE_ROLE_KEY가 없습니다.');
    result.data.push({
      data_type: 'freight_rate', data_key: 'config_error',
      data_value: {}, source: 'data.go.kr', is_complete: false,
      error_message: 'Supabase env not set',
    });
    return result;
  }

  const today    = new Date().toISOString().slice(0, 10);
  const toDate   = toYYYYMMDD(new Date());
  const fromDate = toYYYYMMDD(new Date(Date.now() - 90 * 86_400_000));

  // ── 프로브 모드 ──────────────────────────────────────────────────────────
  if (IS_PROBE) {
    console.log('🔍 --probe 모드: API 응답 구조 확인 (POL: KRPUS)\n');
    const xml = await fetchPage('KRPUS', 1, fromDate, toDate, apiKey);
    console.log('=== 원본 XML (첫 500자) ===');
    console.log(xml.slice(0, 500));
    const { items, totalCount } = parseItems(xml);
    console.log(`\n총 레코드 수: ${totalCount}`);
    if (items.length > 0) {
      console.log('\n=== 첫 번째 아이템 ===');
      console.log(JSON.stringify(items[0], null, 2));
      if (items[1]) {
        console.log('\n=== 두 번째 아이템 ===');
        console.log(JSON.stringify(items[1], null, 2));
      }
    } else {
      console.log('\n아이템 없음 — XML 전체:');
      console.log(xml);
    }
    result.data.push({
      data_type: 'freight_rate', data_key: 'probe',
      data_value: { totalCount }, source: 'data.go.kr', is_complete: true,
    });
    return result;
  }

  // ── POL별 데이터 수집 ────────────────────────────────────────────────────
  console.log(`📥 data.go.kr 화물운임 수집 시작 (${fromDate} ~ ${toDate})...`);
  console.log(`   대상 POL: ${KR_POLS.join(', ')}`);

  const allItems: any[] = [];

  try {
    for (const pol of KR_POLS) {
      const firstXml = await fetchPage(pol, 1, fromDate, toDate, apiKey);
      const { items: firstItems, totalCount } = parseItems(firstXml);

      const totalPages = Math.ceil(totalCount / NUM_OF_ROWS) || 1;
      console.log(`   ${pol}: 총 ${totalCount}건, ${totalPages}페이지`);
      allItems.push(...firstItems);

      for (let page = 2; page <= totalPages; page++) {
        const xml = await fetchPage(pol, page, fromDate, toDate, apiKey);
        const { items } = parseItems(xml);
        allItems.push(...items);
        console.log(`   ${pol}: 페이지 ${page}/${totalPages} (누적 ${allItems.length}건)`);
        await new Promise((r) => setTimeout(r, 200));
      }
    }
  } catch (e) {
    const msg = (e as Error).message;
    console.error(`❌ 수집 실패: ${msg}`);
    result.data.push({
      data_type: 'freight_rate', data_key: 'fetch_error',
      data_value: {}, source: 'data.go.kr', is_complete: false, error_message: msg,
    });
    return result;
  }

  console.log(`   수집 완료: ${allItems.length}건`);

  // ── 매핑 + 중복 제거 ─────────────────────────────────────────────────────
  const mapped = allItems
    .map((item) => mapItem(item, today))
    .filter((r): r is Record<string, any> => r !== null);

  // 같은 onConflict 키가 배치 내에 2개 이상이면 "affect row twice" 에러 → Map으로 제거
  const dedupKey = (r: Record<string, any>) =>
    `${r.ann_no ?? ''}|${r.imxprt_se ?? ''}|${r.pod_code}|${r.container_type}`;
  const dedupMap = new Map<string, Record<string, any>>();
  for (const r of mapped) dedupMap.set(dedupKey(r), r);
  const rows = [...dedupMap.values()];

  console.log(`   매핑: ${mapped.length}건 → 중복 제거 후 ${rows.length}건`);

  if (IS_DRY) {
    console.log(`\n[--dry-run] upsert할 행 샘플 (최대 5건):`);
    console.log(JSON.stringify(rows.slice(0, 5), null, 2));
    console.log(`\n총 ${rows.length}건 — dry-run이므로 DB 반영 안 함.`);
    result.data.push({
      data_type: 'freight_rate', data_key: 'dry_run',
      data_value: { total: rows.length }, source: 'data.go.kr', is_complete: true,
    });
    return result;
  }

  if (rows.length === 0) {
    console.warn('⚠️ 매핑된 행이 없습니다. --probe로 응답 구조를 확인하세요.');
    result.data.push({
      data_type: 'freight_rate', data_key: 'empty',
      data_value: {}, source: 'data.go.kr', is_complete: false,
      error_message: 'no rows mapped',
    });
    return result;
  }

  // ── Supabase upsert (onConflict: ann_no,imxprt_se,pod_code,container_type) ──
  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  const BATCH = 200;
  let upserted = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const { error } = await supabase
      .from('freight_rates')
      .upsert(batch, {
        onConflict: 'ann_no,imxprt_se,pod_code,container_type',
        ignoreDuplicates: false,
      });
    if (error) {
      const msg = `upsert 실패 (batch ${i}~${i + BATCH}): ${error.message}`;
      console.error(`❌ ${msg}`);
      result.data.push({
        data_type: 'freight_rate', data_key: `upsert_error_${i}`,
        data_value: {}, source: 'data.go.kr', is_complete: false, error_message: msg,
      });
      return result;
    }
    upserted += batch.length;
  }

  console.log(`✅ freight_rates upsert 완료: ${upserted}건`);

  // ── data_updates 로그 ────────────────────────────────────────────────────
  await supabase.from('data_updates').insert({
    dataset: 'freight_rates/data.go.kr',
    record_count: upserted,
    status: 'success',
    notes: `${today} 수집 (${fromDate}~${toDate}), POL: ${KR_POLS.join('+')}`,
  });

  result.data.push({
    data_type: 'freight_rate', data_key: `upsert_${today}`,
    data_value: { upserted, fromDate, toDate },
    source: 'data.go.kr 화물운임공표', is_complete: true,
  });

  console.log(`✅ trade_stats: ${result.data.filter(d => d.is_complete).length}/${result.data.length} 완료`);
  return result;
}

if (require.main === module) {
  collect().catch((e) => {
    console.error('❌ freight_rates 실패:', e.message);
    process.exit(1);
  });
}
