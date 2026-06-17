// scripts/check-freight-freshness.mjs
// freight_indices 신선도 가드 — 적재 후 지수별 최신 week_date가 임계를 넘으면 경고.
// 사용: node scripts/check-freight-freshness.mjs
// 환경변수: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (없으면 .env.local 로드)
import * as dotenv from 'dotenv';
import * as path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) { console.error('env 없음 (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)'); process.exit(1); }

// 코드별 허용 stale 일수 (week_date 기준). 핵심 지수는 발표주기 + 여유.
const THRESHOLDS = {
  SCFI: 10, CCFI: 10, KCCI: 10, WCI: 12, FBX: 14, BDI: 14,
  // oneksa 레인/벙커 — 출처(oneksa.kr)가 불규칙(주간~격주) 갱신이라 여유를 둠
  SCFI_USWC: 21, SCFI_EU: 21, SCFI_USEC: 21, HSFO: 21, VLSFO: 21,
  // WCI 레인
  WCI_SHA_RTM: 14, WCI_SHA_GOA: 14, WCI_SHA_LAX: 14, WCI_SHA_NYC: 14,
};
const DEFAULT_THRESHOLD = 16; // KCCI 레인 등 기타
// 핵심 지수만 stale 시 워크플로 실패. 레인/벙커 sublane은 경고만(불규칙 갱신이라 워크플로를 빨갛게 만들지 않음).
const CRITICAL = new Set(['SCFI', 'KCCI', 'WCI', 'CCFI', 'BDI', 'FBX']);

async function latestPerCode() {
  // distinct-on이 어려우므로 최신순 정렬 후 코드별 첫 행만 취함
  const codes = Object.keys(THRESHOLDS);
  const out = {};
  // 코드별 max(week_date) 단건 조회 (정확·경량)
  await Promise.all([...new Set([...codes, 'KCCI_USWC'])].map(async (code) => {
    const res = await fetch(
      `${URL}/rest/v1/freight_indices?select=week_date,value&index_code=eq.${encodeURIComponent(code)}&order=week_date.desc&limit=1`,
      { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } }
    );
    if (!res.ok) return;
    const rows = await res.json();
    if (rows[0]) out[code] = rows[0];
  }));
  return out;
}

const today = new Date();
const daysSince = (d) => Math.round((today - new Date(d + 'T00:00:00Z')) / 86400000);

const latest = await latestPerCode();
const stale = [];
const ok = [];
for (const [code, row] of Object.entries(latest)) {
  const limit = THRESHOLDS[code] ?? DEFAULT_THRESHOLD;
  const age = daysSince(row.week_date);
  (age > limit ? stale : ok).push({ code, date: row.week_date, age, limit, value: row.value });
}

console.log(`\n📅 freight_indices 신선도 점검 (기준일 ${today.toISOString().slice(0,10)})`);
for (const r of [...ok].sort((a,b)=>a.code<b.code?-1:1)) {
  console.log(`  ✅ ${r.code.padEnd(12)} ${r.date}  (${r.age}d ≤ ${r.limit}d)  val=${r.value}`);
}
if (stale.length) {
  console.log('\n⚠️  STALE — 임계 초과:');
  for (const r of stale.sort((a,b)=>b.age-a.age)) {
    console.log(`  ⚠️  ${r.code.padEnd(12)} ${r.date}  (${r.age}d > ${r.limit}d)  val=${r.value}`);
  }
  const criticalStale = stale.filter((r) => CRITICAL.has(r.code));
  if (criticalStale.length) {
    console.error(`\n❌ 핵심 지수 ${criticalStale.length}개 stale: ${criticalStale.map((r) => r.code).join(', ')} — 워크플로 실패.`);
    process.exit(1);
  }
  console.warn(`\n⚠️  보조 sublane ${stale.length}개만 stale (핵심 지수는 신선) — 워크플로 통과.`);
  process.exit(0);
}
console.log('\n✅ 모든 점검 대상 지수가 신선도 임계 이내입니다.');
