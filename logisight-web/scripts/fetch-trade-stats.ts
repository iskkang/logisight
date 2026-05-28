import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import ws from 'ws';
(globalThis as any).WebSocket = ws;

// scripts/fetch-trade-stats.ts
// 관세청 품목별국가별 수출입실적 → trade_statistics 전체 품목 수집
//
// 실행:
//   npx tsx scripts/fetch-trade-stats.ts --probe          (API 패턴 확인: hsSgn 생략 vs 챕터)
//   npx tsx scripts/fetch-trade-stats.ts --dry-run        (수집 조합 목록만, DB 미반영)
//   npx tsx scripts/fetch-trade-stats.ts                  (기본: 국가모드 수집)
//   npx tsx scripts/fetch-trade-stats.ts --mode=chapter   (챕터모드: HS 2자리×국가)
//
// 환경변수 (.env.local):
//   NEXT_PUBLIC_SUPABASE_URL  또는 SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//   DATA_GO_KR_API_KEY  (이미 인코딩된 키 — encodeURIComponent 절대 금지)

import { createClient } from '@supabase/supabase-js';
import { XMLParser } from 'fast-xml-parser';
import { HS_CHAPTERS } from '../lib/hs-chapters';

// ── 환경변수 ─────────────────────────────────────────────────────────────────
const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const API_KEY      = process.env.DATA_GO_KR_API_KEY ?? '';

const BASE_URL = 'https://apis.data.go.kr/1220000/nitemtrade/getNitemtradeList';

const IS_PROBE   = process.argv.includes('--probe');
const IS_DRY     = process.argv.includes('--dry-run');
const MODE       = process.argv.find(a => a.startsWith('--mode='))?.split('=')[1] ?? 'country';

// 주요 교역국 (중복 제거)
const COUNTRIES = ['CN', 'US', 'JP', 'DE', 'VN', 'HK', 'IN', 'TW', 'SG'];

// 최근 3개월 범위 (2개월 지연 기준)
function getDateRange(months = 3): { strtYymm: string; endYymm: string } {
  const end = new Date();
  end.setMonth(end.getMonth() - 2);
  const endYymm = `${end.getFullYear()}${String(end.getMonth() + 1).padStart(2, '0')}`;

  const start = new Date();
  start.setMonth(start.getMonth() - 2 - (months - 1));
  const strtYymm = `${start.getFullYear()}${String(start.getMonth() + 1).padStart(2, '0')}`;

  return { strtYymm, endYymm };
}

// "2026.01" → "202601",  "총계" → null
function parsePeriod(yearStr: string): string | null {
  const s = String(yearStr ?? '').trim();
  if (!s || s === '총계' || s === '-') return null;
  const m = s.match(/^(\d{4})\.(\d{1,2})$/);
  if (!m) return null;
  return `${m[1]}${m[2].padStart(2, '0')}`;
}

const parser = new XMLParser({ ignoreAttributes: false, parseTagValue: true });

interface ApiItem {
  year?:            string | number;
  hsCd?:            string | number;
  statKor?:         string;
  statCd?:          string | number;
  statCdCntnKor1?:  string;
  expDlr?:          string | number;
  expWgt?:          string | number;
  impDlr?:          string | number;
  impWgt?:          string | number;
  balPayments?:     string | number;
  [key: string]:    unknown;
}

// ── API 호출 ─────────────────────────────────────────────────────────────────
// hsSgn: undefined → 생략 (전체 품목), string → 특정 코드
async function fetchData(
  hsSgn: string | undefined,
  cntyCd: string,
  strtYymm: string,
  endYymm: string,
): Promise<{ items: ApiItem[]; rawXml: string }> {
  // .env.local의 키는 이미 인코딩된 형식 → 그대로 사용 (encodeURIComponent 금지)
  let url = `${BASE_URL}?serviceKey=${API_KEY}&cntyCd=${cntyCd}&strtYymm=${strtYymm}&endYymm=${endYymm}`;
  if (hsSgn !== undefined) url += `&hsSgn=${hsSgn}`;

  const res = await fetch(url, {
    headers: { 'User-Agent': 'Logisight/1.0 (logisight.mtlship.com; bot)' },
    signal: AbortSignal.timeout(20_000),
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

function toNum(v: unknown): number | null {
  if (v == null) return null;
  const s = String(v).replace(/,/g, '').trim();
  if (!s || s === '-') return null;
  const n = Number(s);
  return isNaN(n) ? null : n;
}

function mapItem(item: ApiItem, fallbackHs: string, fallbackCnty: string): TradeStatRow | null {
  const period = parsePeriod(String(item.year ?? ''));
  if (!period) return null;

  const hsCd   = String(item.hsCd  ?? fallbackHs).trim();
  const statCd = String(item.statCd ?? fallbackCnty).trim();
  if (hsCd === '-' || statCd === '-') return null;

  return {
    period,
    stat_type:     'item',
    hs_code:       hsCd,
    hs_name:       item.statKor        ? String(item.statKor).trim()        || null : null,
    country_code:  statCd,
    country_name:  item.statCdCntnKor1 ? String(item.statCdCntnKor1).trim() || null : null,
    export_usd:    toNum(item.expDlr),
    export_weight: toNum(item.expWgt),
    import_usd:    toNum(item.impDlr),
    import_weight: toNum(item.impWgt),
    trade_balance: toNum(item.balPayments),
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

  const { strtYymm, endYymm } = getDateRange(13);  // 전월~13개월전 범위

  // ── 1. 프로브 모드 ───────────────────────────────────────────────────────
  if (IS_PROBE) {
    console.log('🔍 --probe: API 패턴 2가지 테스트\n');

    // 테스트 A: hsSgn 생략 (국가 전체 품목)
    console.log(`[A] hsSgn 생략, cntyCd=CN, 기간=${endYymm}`);
    try {
      const { items: itemsA, rawXml: xmlA } = await fetchData(undefined, 'CN', endYymm, endYymm);
      console.log(`    XML 크기: ${xmlA.length}자, 아이템: ${itemsA.length}개`);
      const uniqueHs = new Set(itemsA.map(i => String(i.hsCd ?? '')).filter(Boolean));
      console.log(`    고유 HS코드: ${uniqueHs.size}개 (예: ${[...uniqueHs].slice(0, 5).join(', ')})`);
      if (itemsA.length > 0) console.log(`    첫 행: ${JSON.stringify(itemsA[0])}`);
      else console.log('    아이템 없음 — XML 앞 300자:', xmlA.slice(0, 300));
    } catch (e) {
      console.log(`    실패: ${(e as Error).message}`);
    }

    console.log('');

    // 테스트 B: hsSgn=85 (2자리 챕터)
    console.log(`[B] hsSgn=85, cntyCd=CN, 기간=${endYymm}`);
    try {
      const { items: itemsB, rawXml: xmlB } = await fetchData('85', 'CN', endYymm, endYymm);
      console.log(`    XML 크기: ${xmlB.length}자, 아이템: ${itemsB.length}개`);
      const uniqueHs = new Set(itemsB.map(i => String(i.hsCd ?? '')).filter(Boolean));
      console.log(`    고유 HS코드: ${uniqueHs.size}개 (예: ${[...uniqueHs].slice(0, 5).join(', ')})`);
      if (itemsB.length > 0) console.log(`    첫 행: ${JSON.stringify(itemsB[0])}`);
      else console.log('    아이템 없음 — XML 앞 300자:', xmlB.slice(0, 300));
    } catch (e) {
      console.log(`    실패: ${(e as Error).message}`);
    }

    console.log('\n결론: A가 아이템을 반환하면 --mode=country(기본) 사용.');
    console.log('      A가 비어 있으면 --mode=chapter 사용.');
    return;
  }

  // ── 2. 드라이런 모드 ─────────────────────────────────────────────────────
  const chapters = Object.keys(HS_CHAPTERS);

  if (IS_DRY) {
    if (MODE === 'country') {
      console.log(`[--dry-run / country 모드] ${COUNTRIES.length}개국 × 기간 ${strtYymm}~${endYymm}`);
      COUNTRIES.forEach(c => console.log(`  ${c}`));
    } else {
      const combos = chapters.length * COUNTRIES.length;
      console.log(`[--dry-run / chapter 모드] ${chapters.length}챕터 × ${COUNTRIES.length}국 = ${combos}회 호출`);
      console.log(`기간: ${strtYymm}~${endYymm}`);
    }
    return;
  }

  // ── 3. 전체 수집 ─────────────────────────────────────────────────────────
  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error('❌ SUPABASE_URL 또는 SUPABASE_SERVICE_ROLE_KEY가 없습니다.');
    process.exit(1);
  }

  const allRows: TradeStatRow[] = [];
  let errCount = 0;

  if (MODE === 'country') {
    // 국가 모드: hsSgn 생략 → 해당국 전체 품목
    console.log(`🚀 국가 모드 수집 (${strtYymm}~${endYymm})`);
    console.log(`   ${COUNTRIES.length}개국 수집 중...`);

    for (const cnty of COUNTRIES) {
      try {
        const { items } = await fetchData(undefined, cnty, strtYymm, endYymm);
        const rows = items.map(i => mapItem(i, '', cnty)).filter((r): r is TradeStatRow => r !== null);
        // 유효 hs_code(비어 있지 않은 행)만 저장
        const valid = rows.filter(r => r.hs_code && r.hs_code !== '');
        allRows.push(...valid);
        process.stdout.write(`  ${cnty}(${valid.length})`);
      } catch (e) {
        process.stdout.write(` ${cnty}(err)`);
        errCount++;
      }
      await new Promise(r => setTimeout(r, 100));
    }
    console.log();

  } else {
    // 챕터 모드: HS 2자리 챕터 × 국가
    const combos = chapters.flatMap(ch => COUNTRIES.map(c => ({ ch, c })));
    console.log(`🚀 챕터 모드 수집 (${strtYymm}~${endYymm})`);
    console.log(`   ${combos.length}개 조합 수집 중...`);

    for (const { ch, c } of combos) {
      try {
        const { items } = await fetchData(ch, c, strtYymm, endYymm);
        const rows = items.map(i => mapItem(i, ch, c)).filter((r): r is TradeStatRow => r !== null);
        allRows.push(...rows);
        process.stdout.write('.');
      } catch (e) {
        process.stdout.write('x');
        errCount++;
      }
      await new Promise(r => setTimeout(r, 100));
    }
    console.log();
  }

  console.log(`\n수집 완료: ${allRows.length}행 (오류 ${errCount}건)`);

  if (allRows.length === 0) {
    console.warn('⚠️ 수집된 행이 없습니다. --probe로 API 동작을 먼저 확인하세요.');
    process.exit(1);
  }

  // ── 4. Supabase upsert ───────────────────────────────────────────────────
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false },
    realtime: { enabled: false } as never,
  });

  const BATCH = 200;
  let upserted = 0;
  for (let i = 0; i < allRows.length; i += BATCH) {
    const batch = allRows.slice(i, i + BATCH);
    const { error } = await supabase
      .from('trade_statistics')
      .upsert(batch, { onConflict: 'period,hs_code,country_code', ignoreDuplicates: false });
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
    notes:        `${today} 수집 (${strtYymm}~${endYymm}, mode=${MODE})`,
  });

  console.log('✅ data_updates 기록 완료');
}

main().catch(e => {
  console.error('❌ fetch-trade-stats 실패:', (e as Error).message);
  process.exit(1);
});
