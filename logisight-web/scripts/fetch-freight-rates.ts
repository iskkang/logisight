import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

// scripts/fetch-freight-rates.ts
// 해양수산부 컨테이너 화물운임 공표정보 → freight_rates 테이블 upsert
//
// 실행: npx tsx scripts/fetch-freight-rates.ts
// 탐색: npx tsx scripts/fetch-freight-rates.ts --probe  (API 응답 필드 확인용)
// 건조: npx tsx scripts/fetch-freight-rates.ts --dry-run
//
// 환경변수 (.env.local):
//   NEXT_PUBLIC_SUPABASE_URL      또는 SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//   DATA_GO_KR_API_KEY

import { createClient } from '@supabase/supabase-js';
import { XMLParser } from 'fast-xml-parser';

// ── 환경변수 ─────────────────────────────────────────────────────────────────
const SUPABASE_URL =
  process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const API_KEY = process.env.DATA_GO_KR_API_KEY ?? '';

const BASE_URL = 'https://apis.data.go.kr/1192000/CychgFrghtOut4/Info4';

const IS_PROBE = process.argv.includes('--probe');
const IS_DRY   = process.argv.includes('--dry-run');

// 한국 POL 목록 (부산, 인천, 광양)
const KR_POLS = ['KRPUS', 'KRICN', 'KRGMP'];

const NUM_OF_ROWS = 1000;

// ── 날짜 헬퍼 ─────────────────────────────────────────────────────────────────
function toYYYYMMDD(date: Date): string {
  return date.toISOString().slice(0, 10).replace(/-/g, '');
}

function yyyymmddToDate(s: string): string {
  // '20260515' → '2026-05-15'
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
): Promise<string> {
  // .env.local의 키는 이미 인코딩된 형식(%2B, %3D 포함) → 그대로 사용
  const url = `${BASE_URL}?serviceKey=${API_KEY}&shipngPrtCd=${pol}&pageNo=${pageNo}&numOfRows=${NUM_OF_ROWS}&annGb=v2&fermnDeFr=${fromDate}&fermnDeTo=${toDate}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} — ${url}`);
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
  // 수출(1)만 수집
  const imxprtSe = String(item.imxprtSe ?? '').trim();
  if (imxprtSe && imxprtSe !== '1') return null;

  const polCd   = String(item.shipngPrtCd ?? '').trim().toUpperCase();
  const podCd   = String(item.landngPrtCd ?? '').trim().toUpperCase();
  if (!polCd || !podCd) return null;

  const polNm   = String(item.shipngPrtNm ?? '').trim() || null;
  const podNm   = String(item.landngPrtNm ?? '').trim() || null;
  const carrier = String(item.entrpsNm    ?? '').trim() || null;

  const containerType = resolveContainerType(
    item.contnCnd ?? '1',
    item.contnStdStndrd ?? '2',
  );

  const rateRaw  = item.cychgOf ?? null;
  const rate     = rateRaw !== null ? Number(String(rateRaw).replace(/,/g, '')) : null;

  const validFrom = item.fermnDe
    ? yyyymmddToDate(String(item.fermnDe))
    : today;

  const sourceUpdatedAt = item.annDe
    ? yyyymmddToDate(String(item.annDe))
    : null;

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
    ...featuredProps(polCd, podCd),
  };
}

// ── main ────────────────────────────────────────────────────────────────────
async function main() {
  if (!API_KEY) {
    console.error('❌ DATA_GO_KR_API_KEY 환경변수가 없습니다.');
    process.exit(1);
  }
  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error('❌ SUPABASE_URL 또는 SUPABASE_SERVICE_ROLE_KEY가 없습니다.');
    process.exit(1);
  }

  const today    = new Date().toISOString().slice(0, 10);
  const toDate   = toYYYYMMDD(new Date());
  const fromDate = toYYYYMMDD(new Date(Date.now() - 90 * 86_400_000));

  // ── 1. 프로브 모드 ───────────────────────────────────────────────────────
  if (IS_PROBE) {
    console.log('🔍 --probe 모드: API 응답 구조 확인 (POL: KRPUS)\n');
    const xml = await fetchPage('KRPUS', 1, fromDate, toDate);
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
    return;
  }

  // ── 2. POL별 데이터 수집 ─────────────────────────────────────────────────
  console.log(`📥 data.go.kr 화물운임 수집 시작 (${fromDate} ~ ${toDate})...`);
  console.log(`   대상 POL: ${KR_POLS.join(', ')}`);

  const allItems: any[] = [];

  for (const pol of KR_POLS) {
    const firstXml = await fetchPage(pol, 1, fromDate, toDate);
    const { items: firstItems, totalCount } = parseItems(firstXml);

    const totalPages = Math.ceil(totalCount / NUM_OF_ROWS) || 1;
    console.log(`   ${pol}: 총 ${totalCount}건, ${totalPages}페이지`);

    allItems.push(...firstItems);

    for (let page = 2; page <= totalPages; page++) {
      const xml = await fetchPage(pol, page, fromDate, toDate);
      const { items } = parseItems(xml);
      allItems.push(...items);
      console.log(`   ${pol}: 페이지 ${page}/${totalPages} (누적 ${allItems.length}건)`);
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  console.log(`   수집 완료: ${allItems.length}건`);

  // ── 3. 매핑 ─────────────────────────────────────────────────────────────
  const rows = allItems
    .map((item) => mapItem(item, today))
    .filter((r): r is Record<string, any> => r !== null);

  if (IS_DRY) {
    console.log(`\n[--dry-run] upsert할 행 샘플 (최대 5건):`);
    console.log(JSON.stringify(rows.slice(0, 5), null, 2));
    console.log(`\n총 ${rows.length}건 — dry-run이므로 DB 반영 안 함.`);
    return;
  }

  if (rows.length === 0) {
    console.warn('⚠️ 매핑된 행이 없습니다. --probe로 응답 구조를 확인하세요.');
    return;
  }

  // ── 4. Supabase upsert ───────────────────────────────────────────────────
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  const BATCH = 200;
  let upserted = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const { error } = await supabase
      .from('freight_rates')
      .upsert(batch, {
        onConflict: 'pol_code,pod_code,container_type,carrier,valid_from',
        ignoreDuplicates: false,
      });
    if (error) {
      console.error(`❌ upsert 실패 (batch ${i}~${i + BATCH}):`, error.message);
      process.exit(1);
    }
    upserted += batch.length;
  }

  console.log(`✅ freight_rates upsert 완료: ${upserted}건`);

  // ── 5. data_updates 로그 ────────────────────────────────────────────────
  await supabase.from('data_updates').insert({
    dataset: 'freight_rates/data.go.kr',
    record_count: upserted,
    status: 'success',
    notes: `${today} 수집 (${fromDate}~${toDate}), POL: ${KR_POLS.join('+')}`,
  });

  console.log('✅ data_updates 기록 완료');
}

main().catch((e) => {
  console.error('❌ fetch-freight-rates 실패:', e.message);
  process.exit(1);
});
