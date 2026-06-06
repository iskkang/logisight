'use strict';
// 주간 전망 생성: 타깃 조립 → 채점 → (비-abstain) 산문 → forecasts upsert(draft).
// 실행: node generators/web/forecast/generate.js  (또는 npm run generate:forecasts)
// 발행은 프론트 /admin/forecasts 검수 큐에서만.
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env.local') });

const { WEEKLY_TARGETS, fetchMonthlyTargets } = require('./targets');
const { assembleInput, buildShared } = require('./assemble');
const { scoreForecast } = require('./score');
const { narrate } = require('./narrate');
const { mapVerdictToRow } = require('./row');
const { callClaude } = require('./llm');

// 핵심 루프 — supabase/callLLM 주입(테스트 가능).
async function generateDrafts(supabase, callLLM, { asof = new Date() } = {}) {
  const shared = await buildShared(supabase, asof);
  const monthly = await fetchMonthlyTargets(supabase);
  const targets = [...WEEKLY_TARGETS, ...monthly];
  const res = { total: targets.length, inserted: 0, abstained: 0, needsEditor: 0, errors: 0 };
  for (const t of targets) {
    const input = await assembleInput(supabase, t, { asof, shared });
    const verdict = scoreForecast(input);
    if (verdict.abstain) { res.abstained++; continue; }
    const prose = await narrate(callLLM, input, verdict);
    if (prose.needs_editor) res.needsEditor++;
    const row = mapVerdictToRow(input, verdict, prose);
    const { error } = await supabase.from('forecasts').upsert(row, { onConflict: 'metric_ref,horizon_date,model_version' });
    if (error) { res.errors++; console.error(`❌ upsert [${t.metric_ref}]: ${error.message}`); }
    else { res.inserted++; console.log(`✅ draft [${t.metric_ref}] ${verdict.direction} ${verdict.expected_range_pct ?? ''}${prose.needs_editor ? ' (에디터 작성 필요)' : ''}`); }
  }
  return res;
}

async function main() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('SUPABASE 환경변수 없음');
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false }, realtime: { enabled: false },
  });
  const res = await generateDrafts(supabase, callClaude);
  console.log(`📊 ${res.inserted}/${res.total} draft 적재 · abstain ${res.abstained} · 에디터필요 ${res.needsEditor} · 오류 ${res.errors}`);
}

if (require.main === module) {
  main().catch((e) => { console.error('generate 실패:', e.message); process.exit(1); });
}

module.exports = { generateDrafts };
