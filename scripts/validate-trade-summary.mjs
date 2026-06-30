// scripts/validate-trade-summary.mjs
// trade_summary 적재 검증 — 기준월×차원별 행 수 + 측정값 NULL 비율을 출력한다.
// 더미 0으로 채우지 않으므로 NULL 비율은 "실제 결측"을 의미한다(결측≠0 원칙 확인용).
// 실행: node scripts/validate-trade-summary.mjs [--period=YYYY-MM]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ws from 'ws';
import { createClient } from '@supabase/supabase-js';

// Node 20은 native WebSocket이 없어 supabase-js realtime 초기화가 실패한다(CI Node 22는 불필요).
if (!globalThis.WebSocket) globalThis.WebSocket = ws;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
for (const line of fs.existsSync(path.resolve(__dirname, '../.env.local'))
  ? fs.readFileSync(path.resolve(__dirname, '../.env.local'), 'utf-8').split(/\r?\n/)
  : []) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const onlyArg = process.argv.find((a) => a.startsWith('--period='));
const only = onlyArg ? onlyArg.slice('--period='.length) : null;

const MEASURES = ['export_usd', 'import_usd', 'export_weight', 'import_weight', 'trade_balance'];

let q = sb.from('trade_summary').select('*');
if (only) q = q.eq('period', only);
const { data, error } = await q;
if (error) { console.error('조회 실패:', error.message); process.exit(1); }
if (!data || data.length === 0) { console.error('trade_summary 비어 있음 — 적재 확인 필요'); process.exit(1); }

// 기준월 × 차원별 집계
const groups = new Map();
for (const r of data) {
  const k = `${r.period} · ${r.dim_type}`;
  if (!groups.has(k)) groups.set(k, { n: 0, nulls: Object.fromEntries(MEASURES.map((m) => [m, 0])) });
  const g = groups.get(k);
  g.n += 1;
  for (const m of MEASURES) if (r[m] == null) g.nulls[m] += 1;
}

console.log(`\ntrade_summary 검증 — 총 ${data.length}행${only ? ` (period=${only})` : ''}\n`);
for (const k of [...groups.keys()].sort()) {
  const g = groups.get(k);
  const ratios = MEASURES.map((m) => `${m} ${((g.nulls[m] / g.n) * 100).toFixed(0)}%`).join(' · ');
  console.log(`  ${k.padEnd(26)} 행 ${String(g.n).padStart(4)} | NULL: ${ratios}`);
}
console.log('\n(NULL%% = 측정값 결측 비율. total/hs_chapter는 0%에 가까워야 정상, 일부 국가·weight 결측은 원본 사정상 가능.)');
