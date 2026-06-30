'use strict';
// 이벤트×자산/노선 게이트 → 자동발행 AI 초안 생성.
// 실행: node generators/web/climate-event/generate.js [--dry-run]
const path = require('path');
const { gateEvent } = require('./gate');
const { narrateEventImpact } = require('./narrate');
const { mapEventRow, MODEL_VERSION } = require('./row');

function eventName(title) { return String(title || '').replace(/\s*\(.*\)\s*$/, '').trim() || '이벤트'; }

async function generateEventDrafts(supabase, callLLM, { asof = new Date(), dryRun = false } = {}) {
  const [{ data: events }, { data: assets }, { data: routes }, { data: risk }] = await Promise.all([
    supabase.from('events').select('id,source,kind,title,severity,lon,lat,area,track'),
    supabase.from('assets').select('id,name,type,lon,lat'),
    supabase.from('routes').select('id,name,waypoints'),
    supabase.from('asset_risk').select('asset_id,horizon_days,score,level,driver'),
  ]);
  const nodes = {}; (assets || []).forEach((a) => { nodes[a.id] = a; });
  const riskH0 = {}; (risk || []).forEach((r) => { if (r.horizon_days === 0) riskH0[r.asset_id] = r; });
  const gazetteer = (assets || []).map((a) => a.name).filter(Boolean);

  const res = { events: (events || []).length, linked: 0, inserted: 0, updated: 0, skippedExisting: 0, needsEditor: 0, errors: 0, purged: 0 };
  const currentKeys = new Set();

  for (const e of events || []) {
    const v = gateEvent(e, assets || [], routes || [], nodes);
    if (v.tier === 'LIMITED') continue;
    res.linked++;
    const linkedAssets = v.linkedAssets.map((a) => ({ ...a, risk: riskH0[a.id] || null }));
    const allowedPlaces = new Set([e.area, ...linkedAssets.map((a) => a.name)].filter(Boolean));
    const ctx = { asof, event: { ...e, name: eventName(e.title) }, linkedAssets, linkedRoutes: v.linkedRoutes, gazetteer, allowedPlaces };
    const prose = await narrateEventImpact(callLLM, ctx);
    if (prose.needs_editor) res.needsEditor++;
    const row = mapEventRow(ctx, prose, asof);
    currentKeys.add(row.metric_ref);
    if (dryRun) { console.log(`· [dry:${row.status}] ${row.metric_ref} (${ctx.event.name})`); continue; }
    const { data: existing } = await supabase.from('forecasts').select('id,status').eq('metric_ref', row.metric_ref).eq('model_version', MODEL_VERSION).limit(1);
    let error = null, action = 'insert';
    if (existing && existing.length) {
      if (existing[0].status !== 'draft') { res.skippedExisting++; continue; }
      action = 'update';
      ({ error } = await supabase.from('forecasts').update(row).eq('id', existing[0].id));
    } else {
      ({ error } = await supabase.from('forecasts').insert(row));
    }
    if (error) { res.errors++; console.error(`❌ ${action} [${row.metric_ref}]: ${error.message}`); }
    else { action === 'update' ? res.updated++ : res.inserted++; console.log(`✅ ${row.status} [${row.metric_ref}] ${ctx.event.name}`); }
  }

  // purge: 이번에 재생성 안 된 climate:event draft만 삭제(다른 climate 키 불간섭).
  if (!dryRun) {
    const { data: old } = await supabase.from('forecasts').select('id,metric_ref').eq('module', 'climate').eq('status', 'draft').like('metric_ref', 'climate:event:%');
    for (const d of (old || []).filter((x) => !currentKeys.has(x.metric_ref))) {
      const { error } = await supabase.from('forecasts').delete().eq('id', d.id);
      if (!error) res.purged++;
    }
  }
  return res;
}

async function main() {
  require('dotenv').config({ path: path.resolve(__dirname, '../../../.env.local') });
  if (typeof globalThis.WebSocket === 'undefined') { try { globalThis.WebSocket = require('ws'); } catch (_) {} }
  const dryRun = process.argv.includes('--dry-run');
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('SUPABASE 환경변수 없음');
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY 미설정');
  const { createClient } = require('@supabase/supabase-js');
  const { callClaude } = require('../forecast/llm');
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false }, realtime: { enabled: false } });
  const res = await generateEventDrafts(supabase, callClaude, { dryRun });
  console.log(`📊 events ${res.events} · linked ${res.linked} · 신규 ${res.inserted} · 갱신 ${res.updated} · 보존 ${res.skippedExisting} · 폐기 ${res.purged} · 에디터필요 ${res.needsEditor} · 오류 ${res.errors}${dryRun ? ' (DRY RUN)' : ''}`);
}
if (require.main === module) main().catch((e) => { console.error('climate-event generate 실패:', e.message); process.exit(1); });
module.exports = { generateEventDrafts };
