'use strict';
// 자동 판정: horizon 도래 + 미판정(published, outcome null) 전망의 실측값으로 outcome 자동 확정.
// outcome_note는 비워둠(에디터 복기). 실행: node generators/web/forecast/adjudicate.js
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env.local') });
// Node < 22: supabase-js RealtimeClient가 네이티브 WebSocket을 요구 → ws 폴리필(저장소 공통 패턴).
if (typeof globalThis.WebSocket === 'undefined') { try { globalThis.WebSocket = require('ws'); } catch (_) {} }

const { classifyOutcome } = require('./adjudicate/outcome');
const { fetchActual } = require('./adjudicate/fetch-actual');

function round2(v) { return Math.round(v * 100) / 100; }

// supabase 주입(테스트 가능). 도래·미판정 published 전망을 판정.
async function adjudicateDue(supabase, { asof = new Date() } = {}) {
  const today = asof.toISOString().slice(0, 10);
  const { data: rows, error } = await supabase
    .from('forecasts')
    .select('id,metric_ref,horizon_date,direction,range_low_pct,range_high_pct,metric_value_at_publish')
    .eq('status', 'published')
    .is('outcome', null)
    .lte('horizon_date', today);
  if (error) throw new Error(error.message);
  const res = { due: (rows || []).length, resolved: 0, pending: 0, errors: 0 };
  for (const f of rows || []) {
    const actual = await fetchActual(supabase, f.metric_ref, f.horizon_date);
    if (actual == null) { res.pending++; continue; } // 실측 아직 없음 → 다음 회차 재시도
    if (f.metric_value_at_publish == null || f.metric_value_at_publish === 0) {
      console.warn(`⚠️ ${f.metric_ref}: 기준값(metric_value_at_publish) ${f.metric_value_at_publish} → 판정 보류`);
      res.pending++; continue;
    }
    const realizedPct = round2(((actual - f.metric_value_at_publish) / f.metric_value_at_publish) * 100);
    const outcome = classifyOutcome(f, realizedPct);
    if (!outcome) {
      console.warn(`⚠️ ${f.metric_ref}: 방향값 이상('${f.direction}') → 판정 불가`);
      res.pending++; continue;
    }
    const { error: uerr } = await supabase
      .from('forecasts')
      .update({ outcome, realized_pct: realizedPct, status: 'resolved', resolved_at: new Date().toISOString() })
      .eq('id', f.id);
    if (uerr) { res.errors++; console.error(`❌ update [${f.metric_ref}]: ${uerr.message}`); }
    else { res.resolved++; console.log(`✅ ${f.metric_ref} ${f.direction} → ${outcome} (실측 ${realizedPct}%)${outcome !== 'hit' ? ' · 복기 작성 중' : ''}`); }
  }
  return res;
}

async function main() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('SUPABASE 환경변수 없음');
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false }, realtime: { enabled: false },
  });
  const res = await adjudicateDue(supabase);
  console.log(`📊 도래 ${res.due} · 판정 ${res.resolved} · 보류(실측대기) ${res.pending} · 오류 ${res.errors}`);
}

if (require.main === module) {
  main().catch((e) => { console.error('adjudicate 실패:', e.message); process.exit(1); });
}

module.exports = { adjudicateDue };
