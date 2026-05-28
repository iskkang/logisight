/**
 * scripts/fetch-trade-stats.ts
 * 관세청 수출입무역통계 API 어댑터 — 스텁
 *
 * API 가이드 도착 후 채울 항목:
 *   - BASE_URL: 실제 엔드포인트
 *   - 응답 필드명 매핑 (row → TradeStatRow)
 *   - 파라미터명 확인 (기간, 품목코드 등)
 *
 * 사용법:
 *   ts-node scripts/fetch-trade-stats.ts           # 실제 수집 + upsert
 *   ts-node scripts/fetch-trade-stats.ts --probe   # API 연결 확인만 (DB 미저장)
 */

import * as dotenv from 'dotenv';
import * as path from 'path';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

const API_KEY    = process.env.DATA_GO_KR_API_KEY ?? '';
const SUPA_URL   = process.env.SUPABASE_URL       ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const SUPA_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const IS_PROBE   = process.argv.includes('--probe');

if (!API_KEY) {
  console.error('❌ DATA_GO_KR_API_KEY 환경변수 없음');
  process.exit(1);
}

// ─────────────────────────────────────────────────────────────────────────────
// TODO: API 가이드 도착 후 채울 상수
// ─────────────────────────────────────────────────────────────────────────────

// TODO: 실제 엔드포인트로 교체
const BASE_URL = 'https://unipass.customs.go.kr/cds/openapi/TODO_ENDPOINT';

// TODO: 요청 파라미터 이름 확인 후 수정
interface ApiParams {
  serviceKey: string;
  pageNo: number;
  numOfRows: number;
  // TODO: 기간 파라미터 (예: 'qryYYMM', 'yyyymm', etc.)
  period?: string;
  // TODO: HS코드 파라미터 (예: 'hsCd', 'hsCode', etc.)
  hsCd?: string;
}

// TODO: 실제 API 응답 구조로 교체
interface ApiResponseRow {
  // TODO: 실제 필드명 매핑
  // 예시 (가이드 도착 전까지 플레이스홀더):
  period?: string;       // 기준연월 YYYYMM
  hsCd?: string;         // HS코드
  hsNm?: string;         // 품목명
  expAmt?: string;       // 수출금액
  expWgt?: string;       // 수출중량
  impAmt?: string;       // 수입금액
  impWgt?: string;       // 수입중량
  [key: string]: unknown;
}

// ─────────────────────────────────────────────────────────────────────────────
// DB 행 타입
// ─────────────────────────────────────────────────────────────────────────────
interface TradeStatRow {
  period: string;
  stat_type: string;
  hs_code: string | null;
  hs_name: string | null;
  export_usd: number | null;
  export_weight: number | null;
  import_usd: number | null;
  import_weight: number | null;
  trade_balance: number | null;
  data_source: string;
  fetched_at: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// API 호출
// ─────────────────────────────────────────────────────────────────────────────
async function fetchPage(params: ApiParams): Promise<ApiResponseRow[]> {
  const encodedKey = encodeURIComponent(API_KEY);
  // TODO: 파라미터 조합 방식 확인 (URLSearchParams vs template literal)
  const url = `${BASE_URL}?serviceKey=${encodedKey}`
    + `&pageNo=${params.pageNo}`
    + `&numOfRows=${params.numOfRows}`
    + (params.period ? `&TODO_PERIOD_PARAM=${params.period}` : '')
    + (params.hsCd   ? `&TODO_HSCODE_PARAM=${params.hsCd}` : '');

  const res = await fetch(url, {
    headers: { 'User-Agent': 'Logisight/1.0 (logisight.mtlship.com; bot)' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);

  // TODO: XML 또는 JSON 응답 파싱 확인
  const text = await res.text();
  console.log('[probe] 응답 앞 500자:', text.slice(0, 500));

  // TODO: 응답 형식에 따라 파싱 로직 작성
  // XML의 경우: import { XMLParser } from 'fast-xml-parser'
  // JSON의 경우: JSON.parse(text)
  return []; // placeholder
}

// ─────────────────────────────────────────────────────────────────────────────
// 응답 → DB 행 매핑
// ─────────────────────────────────────────────────────────────────────────────
function mapRow(raw: ApiResponseRow): TradeStatRow {
  const now = new Date().toISOString();
  // TODO: 실제 필드명으로 교체
  const exportUsd  = raw.expAmt  ? parseFloat(String(raw.expAmt))  : null;
  const importUsd  = raw.impAmt  ? parseFloat(String(raw.impAmt))  : null;
  return {
    period:        String(raw.period ?? ''),
    stat_type:     'item',
    hs_code:       raw.hsCd  ? String(raw.hsCd)  : null,
    hs_name:       raw.hsNm  ? String(raw.hsNm)  : null,
    export_usd:    exportUsd,
    export_weight: raw.expWgt ? parseFloat(String(raw.expWgt)) : null,
    import_usd:    importUsd,
    import_weight: raw.impWgt ? parseFloat(String(raw.impWgt)) : null,
    trade_balance: exportUsd !== null && importUsd !== null ? exportUsd - importUsd : null,
    data_source:   '관세청 수출입무역통계',
    fetched_at:    now,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Supabase upsert
// ─────────────────────────────────────────────────────────────────────────────
async function upsertRows(rows: TradeStatRow[]): Promise<void> {
  if (!SUPA_URL || !SUPA_KEY) {
    console.warn('⚠️ SUPABASE 환경변수 없음 — DB upsert 스킵');
    return;
  }
  const supabase = createClient(SUPA_URL, SUPA_KEY);
  const { error } = await supabase
    .from('trade_statistics')
    .upsert(rows, { onConflict: 'period,stat_type,hs_code,country_code', ignoreDuplicates: false });
  if (error) throw new Error(`upsert 실패: ${error.message}`);
  console.log(`✅ trade_statistics upsert ${rows.length}행`);
}

// ─────────────────────────────────────────────────────────────────────────────
// 메인
// ─────────────────────────────────────────────────────────────────────────────

// 대상 HS코드 (industry-hs-map.ts의 hsCodes와 동기화)
const TARGET_HS_CODES = ['8507', '850760', '8703', '8704', '8708', '0303', '0307', '0207', '2106'];

// TODO: 기준연월 계산 (전월 기준 등)
const CURRENT_PERIOD = (() => {
  const d = new Date();
  d.setMonth(d.getMonth() - 1); // 전월 기준
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`;
})();

async function main() {
  console.log('🚀 관세청 수출입무역통계 수집 시작');
  console.log(`   기준연월: ${CURRENT_PERIOD}`);
  console.log(`   대상 HS코드: ${TARGET_HS_CODES.join(', ')}`);
  if (IS_PROBE) console.log('   모드: --probe (DB 미저장)');

  const allRows: TradeStatRow[] = [];

  for (const hsCd of TARGET_HS_CODES) {
    try {
      console.log(`\n🔄 HS${hsCd} 수집 중...`);
      const rawRows = await fetchPage({
        serviceKey: API_KEY,
        pageNo: 1,
        numOfRows: 100,
        period: CURRENT_PERIOD,
        hsCd,
      });
      const mapped = rawRows.map(mapRow);
      allRows.push(...mapped);
      console.log(`   → ${mapped.length}행 파싱`);
    } catch (e) {
      console.warn(`   ⚠️ HS${hsCd} 실패: ${(e as Error).message}`);
    }
  }

  console.log(`\n총 ${allRows.length}행 수집`);

  if (IS_PROBE) {
    console.log('\n[probe 모드] DB 저장 스킵. 수집 완료.');
    return;
  }

  if (allRows.length > 0) {
    await upsertRows(allRows);
  } else {
    console.warn('⚠️ 수집된 행 없음 — API 응답 구조 확인 필요');
    process.exit(1);
  }
}

main().catch((e) => {
  console.error('❌ 치명적 오류:', (e as Error).message);
  process.exit(1);
});
