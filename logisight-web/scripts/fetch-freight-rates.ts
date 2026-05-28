// scripts/fetch-freight-rates.ts
// 해양수산부 컨테이너 화물운임 공표정보 → freight_rates 테이블 upsert
//
// 실행: npx tsx scripts/fetch-freight-rates.ts
// 탐색: npx tsx scripts/fetch-freight-rates.ts --probe  (API 응답 필드 확인용)
//
// 환경변수 (.env.local):
//   NEXT_PUBLIC_SUPABASE_URL      또는 SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//   DATA_GO_KR_API_KEY

import { createClient } from '@supabase/supabase-js';

// ── 환경변수 ─────────────────────────────────────────────────────────────────
const SUPABASE_URL =
  process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const API_KEY = process.env.DATA_GO_KR_API_KEY ?? '';

const BASE_URL =
  'https://apis.data.go.kr/1192000/BulkFreightFeeInfoService/getBulkFreightFeeList';

const IS_PROBE = process.argv.includes('--probe');
const IS_DRY   = process.argv.includes('--dry-run');

// ── 컨테이너 타입 정규화 ────────────────────────────────────────────────────
function normalizeContainerType(raw: string): string {
  const s = (raw ?? '').toUpperCase().replace(/\s/g, '');
  if (s.includes('20') && s.includes('DRY'))  return '20DRY';
  if (s.includes('40') && s.includes('HC'))   return '40HC';
  if (s.includes('40') && s.includes('DRY'))  return '40DRY';
  if (s.includes('20') && s.includes('RF'))   return '20RF';
  if (s.includes('40') && s.includes('RF'))   return '40RF';
  if (s === '20' || s === '20GP')             return '20DRY';
  if (s === '40' || s === '40GP')             return '40DRY';
  return s.slice(0, 10);
}

// ── API 호출 ─────────────────────────────────────────────────────────────────
async function fetchPage(pageNo: number, numOfRows: number): Promise<any> {
  const params = new URLSearchParams({
    serviceKey: API_KEY,
    pageNo: String(pageNo),
    numOfRows: String(numOfRows),
    returnType: 'json',
  });
  const url = `${BASE_URL}?${params}`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} — ${url}`);
  return res.json();
}

// ── API 응답에서 아이템 배열 추출 ─────────────────────────────────────────────
function extractItems(json: any): any[] {
  // data.go.kr 공통 응답 구조
  const body = json?.response?.body ?? json?.body ?? json;
  const items = body?.items?.item ?? body?.items ?? body?.item ?? [];
  return Array.isArray(items) ? items : items ? [items] : [];
}

// ── 아이템 → freight_rates 행 매핑 ──────────────────────────────────────────
// ⚠️ 필드명은 --probe 결과로 확인 후 수정 필요.
//    data.go.kr API 서비스마다 필드명이 다를 수 있음.
function mapItem(item: any, today: string): Record<string, any> | null {
  // 가능한 필드명 후보로 순서대로 시도
  const polNm  = item.polNm  ?? item.departNm  ?? item.polName  ?? item.deptNm  ?? '';
  const polCd  = item.polCd  ?? item.departCd  ?? item.polCode  ?? item.deptCd  ?? 'UNKNOWN';
  const podNm  = item.podNm  ?? item.destNm    ?? item.podName  ?? item.destName ?? '';
  const podCd  = item.podCd  ?? item.destCd    ?? item.podCode  ?? item.destCd   ?? 'UNKNOWN';
  const cntrRaw= item.cntnrKndCd ?? item.cntnrTpCd ?? item.cntKndCd ?? item.cntrType ?? item.containerType ?? '40DRY';
  const rateRaw= item.frachtFeeAmt ?? item.freightFee ?? item.shprtFee ?? item.feeAmt ?? item.rate ?? null;
  const carrier= item.shrpNm ?? item.carNm ?? item.shippingNm ?? item.carrierNm ?? null;
  const baseDt = item.basYm  ?? item.basYmd  ?? item.baseYm   ?? item.baseDt   ?? today;

  const rate = rateRaw !== null ? Number(String(rateRaw).replace(/,/g, '')) : null;
  const containerType = normalizeContainerType(cntrRaw);

  if (!polCd || !podCd) return null;

  // baseDt가 YYYYMM(6자리)이면 월 말로 변환
  let validFrom = baseDt;
  if (validFrom && /^\d{6}$/.test(validFrom)) {
    validFrom = `${validFrom.slice(0, 4)}-${validFrom.slice(4, 6)}-01`;
  } else if (validFrom && /^\d{8}$/.test(validFrom)) {
    validFrom = `${validFrom.slice(0, 4)}-${validFrom.slice(4, 6)}-${validFrom.slice(6, 8)}`;
  }

  return {
    pol_code: polCd.trim().toUpperCase(),
    pol_name: polNm.trim() || null,
    pod_code: podCd.trim().toUpperCase(),
    pod_name: podNm.trim() || null,
    container_type: containerType,
    rate_usd: rate,
    currency: 'USD',
    carrier: carrier?.trim() || null,
    data_source: 'data.go.kr/해양수산부',
    valid_from: validFrom || today,
    display_order: 0,
  };
}

// ── main ────────────────────────────────────────────────────────────────────
async function main() {
  if (!API_KEY) {
    console.error('❌ DATA_GO_KR_API_KEY 환경변수가 없습니다.');
    console.error('   .env.local에 DATA_GO_KR_API_KEY=발급받은키 추가 후 재실행하세요.');
    process.exit(1);
  }

  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error('❌ SUPABASE_URL 또는 SUPABASE_SERVICE_ROLE_KEY가 없습니다.');
    process.exit(1);
  }

  const today = new Date().toISOString().slice(0, 10);

  // ── 1. 프로브 모드: 첫 번째 아이템의 키 출력 후 종료 ─────────────────────
  if (IS_PROBE) {
    console.log('🔍 --probe 모드: API 응답 구조 확인\n');
    const json = await fetchPage(1, 3);
    console.log('=== 전체 응답 구조 (depth 1) ===');
    console.log(JSON.stringify(Object.keys(json), null, 2));

    const items = extractItems(json);
    if (items.length > 0) {
      console.log('\n=== 첫 번째 아이템 필드 ===');
      console.log(JSON.stringify(items[0], null, 2));
    } else {
      console.log('\n=== 아이템 없음 — 전체 응답 ===');
      console.log(JSON.stringify(json, null, 2));
    }
    console.log('\n→ 필드명 확인 후 scripts/fetch-freight-rates.ts의 mapItem() 함수를 수정하세요.');
    return;
  }

  // ── 2. 전체 데이터 수집 ───────────────────────────────────────────────────
  console.log('📥 data.go.kr 화물운임 수집 시작...');

  const firstPage = await fetchPage(1, 100);
  const totalCount: number =
    firstPage?.response?.body?.totalCount ??
    firstPage?.body?.totalCount ??
    firstPage?.totalCount ?? 0;
  const numOfRows = 100;
  const totalPages = Math.ceil(totalCount / numOfRows) || 1;

  console.log(`   총 ${totalCount}건, ${totalPages}페이지`);

  const allItems: any[] = extractItems(firstPage);
  for (let page = 2; page <= totalPages; page++) {
    const pageJson = await fetchPage(page, numOfRows);
    allItems.push(...extractItems(pageJson));
    await new Promise((r) => setTimeout(r, 200)); // rate limit
  }

  console.log(`   수집 완료: ${allItems.length}건`);

  // ── 3. 매핑 ──────────────────────────────────────────────────────────────
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

  // ── 4. Supabase upsert ────────────────────────────────────────────────────
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  const { error: upsertErr } = await supabase
    .from('freight_rates')
    .upsert(rows, {
      onConflict: 'pol_code,pod_code,container_type,data_source',
      ignoreDuplicates: false,
    });

  if (upsertErr) {
    console.error('❌ upsert 실패:', upsertErr.message);
    process.exit(1);
  }

  console.log(`✅ freight_rates upsert 완료: ${rows.length}건`);

  // ── 5. data_updates 로그 ─────────────────────────────────────────────────
  await supabase.from('data_updates').insert({
    dataset: 'freight_rates/data.go.kr',
    record_count: rows.length,
    status: 'success',
    notes: `${today} 수집`,
  });

  console.log('✅ data_updates 기록 완료');
}

main().catch((e) => {
  console.error('❌ fetch-freight-rates 실패:', e.message);
  process.exit(1);
});
