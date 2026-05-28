import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

// scripts/fetch-trade-stats.ts
// 관세청 품목별국가별 수출입실적 API → trade_statistics 테이블 upsert
//
// 실행: npx tsx scripts/fetch-trade-stats.ts
// 탐색: npx tsx scripts/fetch-trade-stats.ts --probe    (HS8507×US 1개월, 원시 XML 출력)
// 건조: npx tsx scripts/fetch-trade-stats.ts --dry-run  (조합 목록만, DB 미반영)
//
// 환경변수 (.env.local):
//   NEXT_PUBLIC_SUPABASE_URL  또는 SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//   DATA_GO_KR_API_KEY

import { createClient } from '@supabase/supabase-js';
import { XMLParser } from 'fast-xml-parser';

// ── 환경변수 ─────────────────────────────────────────────────────────────────
const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const API_KEY      = process.env.DATA_GO_KR_API_KEY ?? '';

const BASE_URL = 'https://apis.data.go.kr/1220000/nitemtrade/getNitemtradeList';

const IS_PROBE = process.argv.includes('--probe');
const IS_DRY   = process.argv.includes('--dry-run');

// ── 대상 정의 ─────────────────────────────────────────────────────────────────
const HS_CODES = {
  battery: ['8507'],                    // 축전지/이차전지
  auto:    ['8703', '8708'],            // 승용차, 자동차부품
  cold:    ['0303', '0202', '0203'],    // 냉동어류, 냉동쇠고기, 냉동돼지고기
};

const COUNTRIES = ['US', 'CN', 'JP', 'DE', 'VN', 'IN', 'NL', 'HK'];

// ── 날짜 범위 ─────────────────────────────────────────────────────────────────
// 관세청 데이터는 1~2개월 지연 → endYymm = 2개월 전, strtYymm = 13개월 전
function getDateRange(): { strtYymm: string; endYymm: string } {
  const end = new Date();
  end.setMonth(end.getMonth() - 2);
  const endYymm = `${end.getFullYear()}${String(end.getMonth() + 1).padStart(2, '0')}`;

  const start = new Date();
  start.setMonth(start.getMonth() - 13);
  const strtYymm = `${start.getFullYear()}${String(start.getMonth() + 1).padStart(2, '0')}`;

  return { strtYymm, endYymm };
}

// ── 기간 파싱 ─────────────────────────────────────────────────────────────────
// "2026.01" → "202601",  "2026.1" → "202601",  "총계" → null
function parsePeriod(yearStr: string): string | null {
  const s = String(yearStr ?? '').trim();
  if (!s || s === '총계' || s === '-') return null;
  const m = s.match(/^(\d{4})\.(\d{1,2})$/);
  if (!m) return null;
  return `${m[1]}${m[2].padStart(2, '0')}`;
}

// ── XML 파서 ─────────────────────────────────────────────────────────────────
const parser = new XMLParser({ ignoreAttributes: false, parseTagValue: true });

interface ApiItem {
  year?:   string | number;
  hsCd?:   string | number;
  hsNm?:   string;
  statCd?: string | number;
  statNm?: string;
  expAmt?: string | number;
  expWgt?: string | number;
  impAmt?: string | number;
  impWgt?: string | number;
  [key: string]: unknown;
}

// ── API 호출 ─────────────────────────────────────────────────────────────────
async function fetchData(
  hsSgn: string,
  cntyCd: string,
  strtYymm: string,
  endYymm: string,
): Promise<{ items: ApiItem[]; rawXml: string }> {
  // .env.local 키는 디코딩 형식(+, = 포함) → encodeURIComponent 적용
  const key = encodeURIComponent(API_KEY);
  const url = `${BASE_URL}?serviceKey=${key}&hsSgn=${hsSgn}&cntyCd=${cntyCd}&strtYymm=${strtYymm}&endYymm=${endYymm}`;

  const res = await fetch(url, {
    headers: { 'User-Agent': 'Logisight/1.0 (logisight.mtlship.com; bot)' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);

  const rawXml = await res.text();

  const obj  = parser.parse(rawXml);
  const body = obj?.response?.body ?? obj?.body ?? {};
  const raw  = body?.items?.item ?? [];
  const items: ApiItem[] = Array.isArray(raw) ? raw : raw ? [raw] : [];

  return { items, rawXml };
}

// ── 행 타입 ──────────────────────────────────────────────────────────────────
interface TradeStatRow {
  period:        string;
  stat_type:     string;
  hs_code:       string;
  hs_name:       string | null;
  country_code:  string;
  country_name:  string | null;
  export_usd:    number | null;
  export_weight: number | null;
  import_usd:    number | null;
  import_weight: number | null;
  trade_balance: number | null;
  data_source:   string;
  fetched_at:    string;
}

// ── 숫자 변환 헬퍼 ────────────────────────────────────────────────────────────
function toUsd(v: unknown): number | null {
  if (v == null) return null;
  const s = String(v).replace(/,/g, '').trim();
  if (!s || s === '-') return null;
  const n = Number(s);
  // API 금액 단위: 천달러 → USD 변환
  return isNaN(n) ? null : Math.round(n * 1000);
}

function toWeight(v: unknown): number | null {
  if (v == null) return null;
  const s = String(v).replace(/,/g, '').trim();
  if (!s || s === '-') return null;
  const n = Number(s);
  return isNaN(n) ? null : n; // 단위: MT (metric ton)
}

// ── API 아이템 → DB 행 매핑 ──────────────────────────────────────────────────
function mapItem(item: ApiItem, hsSgn: string, cntyCd: string): TradeStatRow | null {
  const period = parsePeriod(String(item.year ?? ''));
  if (!period) return null;

  const hsCd   = String(item.hsCd  ?? hsSgn).trim();
  const statCd = String(item.statCd ?? cntyCd).trim();
  if (hsCd === '-' || statCd === '-') return null;

  const exportUsd = toUsd(item.expAmt);
  const importUsd = toUsd(item.impAmt);

  return {
    period,
    stat_type:     'item',
    hs_code:       hsCd,
    hs_name:       item.hsNm  ? String(item.hsNm).trim()  || null : null,
    country_code:  statCd,
    country_name:  item.statNm ? String(item.statNm).trim() || null : null,
    export_usd:    exportUsd,
    export_weight: toWeight(item.expWgt),
    import_usd:    importUsd,
    import_weight: toWeight(item.impWgt),
    trade_balance: exportUsd !== null && importUsd !== null ? exportUsd - importUsd : null,
    data_source:   '관세청 수출입무역통계',
    fetched_at:    new Date().toISOString(),
  };
}

// ── main ─────────────────────────────────────────────────────────────────────
async function main() {
  if (!API_KEY) {
    console.error('❌ DATA_GO_KR_API_KEY 환경변수가 없습니다.');
    process.exit(1);
  }

  const { strtYymm, endYymm } = getDateRange();

  // ── 1. 프로브 모드 ───────────────────────────────────────────────────────
  if (IS_PROBE) {
    console.log('🔍 --probe 모드: API 응답 구조 확인\n');
    console.log(`   파라미터: hsSgn=8507, cntyCd=US, strtYymm=${endYymm}, endYymm=${endYymm}\n`);

    const { items, rawXml } = await fetchData('8507', 'US', endYymm, endYymm);

    console.log('=== 원본 XML (첫 800자) ===');
    console.log(rawXml.slice(0, 800));
    console.log(`\n총 ${items.length}개 아이템 파싱`);

    if (items.length > 0) {
      console.log('\n=== 첫 번째 아이템 ===');
      console.log(JSON.stringify(items[0], null, 2));
      if (items[1]) {
        console.log('\n=== 두 번째 아이템 ===');
        console.log(JSON.stringify(items[1], null, 2));
      }
    } else {
      console.log('\n아이템 없음 — XML 전체:');
      console.log(rawXml);
    }

    const mapped = items.map(i => mapItem(i, '8507', 'US')).filter(Boolean);
    console.log(`\n=== 매핑 결과 (${mapped.length}행) ===`);
    if (mapped.length > 0) console.log(JSON.stringify(mapped[0], null, 2));
    return;
  }

  // ── 2. 드라이런 모드 ─────────────────────────────────────────────────────
  const allHsCodes = [...HS_CODES.battery, ...HS_CODES.auto, ...HS_CODES.cold];
  const combinations: Array<{ hsCd: string; country: string }> = [];
  for (const hsCd of allHsCodes) {
    for (const country of COUNTRIES) {
      combinations.push({ hsCd, country });
    }
  }

  if (IS_DRY) {
    console.log(`[--dry-run] 수집 대상: ${combinations.length}개 조합`);
    console.log(`기간: ${strtYymm} ~ ${endYymm}`);
    for (const c of combinations) {
      console.log(`  HS${c.hsCd} × ${c.country}`);
    }
    return;
  }

  // ── 3. 전체 수집 ─────────────────────────────────────────────────────────
  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error('❌ SUPABASE_URL 또는 SUPABASE_SERVICE_ROLE_KEY가 없습니다.');
    process.exit(1);
  }

  console.log(`🚀 관세청 무역통계 수집 시작 (${strtYymm} ~ ${endYymm})`);
  console.log(`   ${combinations.length}개 조합 수집 중...`);

  const allRows: TradeStatRow[] = [];
  let errCount = 0;

  for (const { hsCd, country } of combinations) {
    try {
      const { items } = await fetchData(hsCd, country, strtYymm, endYymm);
      const rows = items
        .map(i => mapItem(i, hsCd, country))
        .filter((r): r is TradeStatRow => r !== null);
      allRows.push(...rows);
      process.stdout.write('.');
    } catch (e) {
      process.stdout.write('x');
      console.warn(`\n   ⚠️ HS${hsCd} × ${country}: ${(e as Error).message}`);
      errCount++;
    }
    await new Promise(r => setTimeout(r, 100));
  }

  console.log(`\n\n수집 완료: ${allRows.length}행 (오류 ${errCount}건)`);

  if (allRows.length === 0) {
    console.warn('⚠️ 수집된 행이 없습니다. --probe로 응답 구조를 확인하세요.');
    process.exit(1);
  }

  // ── 4. Supabase upsert ───────────────────────────────────────────────────
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  const BATCH = 200;
  let upserted = 0;
  for (let i = 0; i < allRows.length; i += BATCH) {
    const batch = allRows.slice(i, i + BATCH);
    const { error } = await supabase
      .from('trade_statistics')
      .upsert(batch, {
        onConflict: 'period,hs_code,country_code',
        ignoreDuplicates: false,
      });
    if (error) {
      console.error(`❌ upsert 실패 (batch ${i}~${i + BATCH}):`, error.message);
      process.exit(1);
    }
    upserted += batch.length;
  }

  console.log(`✅ trade_statistics upsert: ${upserted}행`);

  // ── 5. data_updates 로그 ────────────────────────────────────────────────
  const today = new Date().toISOString().slice(0, 10);
  await supabase.from('data_updates').insert({
    dataset:      'trade_statistics/customs.go.kr',
    record_count: upserted,
    status:       'success',
    notes:        `${today} 수집 (${strtYymm}~${endYymm}, ${combinations.length}조합)`,
  });

  console.log('✅ data_updates 기록 완료');
}

main().catch(e => {
  console.error('❌ fetch-trade-stats 실패:', (e as Error).message);
  process.exit(1);
});
