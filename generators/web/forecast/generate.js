'use strict';
// 주간 전망 생성: 타깃 조립 → 채점 → (비-abstain) 산문 → forecasts upsert(draft).
// 실행: node generators/web/forecast/generate.js  (또는 npm run generate:forecasts)
// 발행은 프론트 /admin/forecasts 검수 큐에서만.
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env.local') });
// Node < 22: supabase-js RealtimeClient가 네이티브 WebSocket을 요구 → ws 폴리필(저장소 공통 패턴).
if (typeof globalThis.WebSocket === 'undefined') { try { globalThis.WebSocket = require('ws'); } catch (_) {} }

const { WEEKLY_TARGETS, fetchMonthlyTargets } = require('./targets');
const { assembleInput, buildShared } = require('./assemble');
const { scoreForecast } = require('./score');
const { narrate } = require('./narrate');
const { mapVerdictToRow } = require('./row');
const { callClaude } = require('./llm');
const { assertSchema } = require('./preflight');

// 최근 해운 뉴스(정성 근거) — narrate에 컨텍스트로 1회 주입. 점수에는 영향 없음.
async function fetchRecentNews(supabase, asof = new Date()) {
  const since = new Date(asof.getTime() - 14 * 86400000).toISOString();
  const { data } = await supabase
    .from('maritime_news')
    .select('title,summary,published_at')
    .gte('published_at', since)
    .order('published_at', { ascending: false })
    .limit(12);
  return (data || []).map((n) => ({ title: n.title, summary: n.summary }));
}

// 핵심 루프 — supabase/callLLM 주입(테스트 가능).
async function generateDrafts(supabase, callLLM, { asof = new Date() } = {}) {
  const shared = await buildShared(supabase, asof);
  const news = await fetchRecentNews(supabase, asof);
  const monthly = await fetchMonthlyTargets(supabase);
  const targets = [...WEEKLY_TARGETS, ...monthly];
  const res = { total: targets.length, inserted: 0, updated: 0, skipped: 0, abstained: 0, needsEditor: 0, errors: 0 };
  for (const t of targets) {
    const input = await assembleInput(supabase, t, { asof, shared });
    const verdict = scoreForecast(input);
    if (verdict.abstain) { res.abstained++; continue; }
    const prose = await narrate(callLLM, input, verdict, { news });
    if (prose.needs_editor) res.needsEditor++;
    const row = mapVerdictToRow(input, verdict, prose, asof);

    // (metric_ref, horizon_date, model_version) 기준 dedup — DB onConflict 인덱스에 의존하지 않고,
    // 이미 발행/판정된 행은 절대 덮어쓰지 않는다(불변성). 같은 키의 draft만 갱신.
    const { data: existing } = await supabase
      .from('forecasts')
      .select('id,status')
      .eq('metric_ref', row.metric_ref)
      .eq('horizon_date', row.horizon_date)
      .eq('model_version', row.model_version)
      .limit(1);
    let error = null;
    let action = 'insert';
    if (existing && existing.length) {
      if (existing[0].status !== 'draft') {
        res.skipped++;
        console.log(`↩︎ skip [${t.metric_ref}] 이미 ${existing[0].status} (보존)`);
        continue;
      }
      action = 'update';
      ({ error } = await supabase.from('forecasts').update(row).eq('id', existing[0].id));
    } else {
      ({ error } = await supabase.from('forecasts').insert(row));
    }
    if (error) { res.errors++; console.error(`❌ ${action} [${t.metric_ref}]: ${error.message}`); }
    else {
      if (action === 'update') res.updated++; else res.inserted++;
      console.log(`✅ draft [${t.metric_ref}] ${verdict.direction} ${verdict.expected_range_pct ?? ''}${prose.needs_editor ? ' (에디터 작성 필요)' : ''}`);
    }
  }
  return res;
}

async function main() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('SUPABASE 환경변수 없음');
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false }, realtime: { enabled: false },
  });
  await assertSchema(supabase); // 마이그레이션 가드 — 누락 시 여기서 명시적 실패.
  const res = await generateDrafts(supabase, callClaude);
  console.log(`📊 신규 ${res.inserted} · 갱신 ${res.updated} · 보존 ${res.skipped} / ${res.total} 타깃 · abstain ${res.abstained} · 에디터필요 ${res.needsEditor} · 오류 ${res.errors}`);
}

if (require.main === module) {
  main().catch((e) => { console.error('generate 실패:', e.message); process.exit(1); });
}

module.exports = { generateDrafts };
