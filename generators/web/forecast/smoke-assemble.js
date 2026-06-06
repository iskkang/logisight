'use strict';
// 읽기 전용 스모크: 모든 타깃의 입력을 조립하고 scoreForecast 결과를 출력. DB 쓰기 없음.
// 실행: node generators/web/forecast/smoke-assemble.js
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env.local') });
// Node < 22: supabase-js RealtimeClient가 네이티브 WebSocket을 요구 → ws 폴리필(저장소 공통 패턴).
if (typeof globalThis.WebSocket === 'undefined') { try { globalThis.WebSocket = require('ws'); } catch (_) {} }

const { WEEKLY_TARGETS, fetchMonthlyTargets } = require('./targets');
const { assembleInput, buildShared } = require('./assemble');
const { scoreForecast } = require('./score');

async function main() {
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false }, realtime: { enabled: false },
  });
  const asof = new Date();
  const shared = await buildShared(supabase, asof);
  const monthly = await fetchMonthlyTargets(supabase);
  const targets = [...WEEKLY_TARGETS, ...monthly];
  console.log(`타깃 ${targets.length}개 (주간 ${WEEKLY_TARGETS.length} · 월간 ${monthly.length})`);
  for (const t of targets) {
    const input = await assembleInput(supabase, t, { asof, shared });
    const r = scoreForecast(input);
    if (r.abstain) {
      console.log(`⏸️  ${t.label} [${t.metric_ref}] → abstain: ${r.reason}`);
    } else {
      console.log(`📈 ${t.label} [${t.metric_ref}] → ${r.direction}/${r.strength} ${r.expected_range_pct ?? ''} (comp ${r.composite_score}, conf ${r.confidence}) flags:[${r.data_quality_flags.join('; ')}]`);
    }
  }
}

main().catch((e) => { console.error('smoke 실패:', e.message); process.exit(1); });
