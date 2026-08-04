'use strict';
// 이벤트×자산/노선 게이트 → 자동발행 AI 초안 생성.
// 실행: node generators/web/climate-event/generate.js [--dry-run]
const path = require('path');
const { gateEvent } = require('./gate');
const { narrateEventImpact } = require('./narrate');
const { mapEventRow, MODEL_VERSION } = require('./row');

function eventName(title) { return String(title || '').replace(/\s*\(.*\)\s*$/, '').trim() || '이벤트'; }

async function generateEventDrafts(supabase, callLLM, { asof = new Date(), dryRun = false, langs = ['ko', 'ja'] } = {}) {
  const [{ data: events }, { data: assets }, { data: routes }, { data: risk }] = await Promise.all([
    supabase.from('events').select('id,source,kind,title,severity,lon,lat,area,track'),
    supabase.from('assets').select('id,name,name_ja,type,lon,lat'),
    supabase.from('routes').select('id,name,name_ja,waypoints'),
    supabase.from('asset_risk').select('asset_id,horizon_days,score,level,driver'),
  ]);
  const nodes = {}; (assets || []).forEach((a) => { nodes[a.id] = a; });
  const riskH0 = {}; (risk || []).forEach((r) => { if (r.horizon_days === 0) riskH0[r.asset_id] = r; });
  // 환각 검사용 지명 사전. 두 언어 이름을 모두 넣지 않으면 일본어 본문의 '東京港'이
  // 입력 밖 지명으로 걸려 전부 보류된다.
  const gazetteer = (assets || []).flatMap((a) => [a.name, a.name_ja]).filter(Boolean);

  const res = { events: (events || []).length, linked: 0, inserted: 0, updated: 0, skippedExisting: 0, needsEditor: 0, errors: 0, purged: 0 };
  const currentKeys = new Set();

  for (const e of events || []) {
    const v = gateEvent(e, assets || [], routes || [], nodes);
    if (v.tier === 'LIMITED') continue;
    res.linked++;
    const linkedAssets = v.linkedAssets.map((a) => ({ ...a, risk: riskH0[a.id] || null }));
    // 노선명도 허용 지명에 넣는다. 프롬프트로 준 노선을 본문이 부르는 것은 환각이 아닌데,
    // 노선명이 자산명을 품고 있어서('아시아–유럽 (희망봉 우회)' ⊃ '희망봉') 환각으로 걸렸다.
    // 연관 자산이 비고 노선만 걸린 이벤트에서 특히 자주 터진다.
    const allowedPlaces = new Set([
      e.area,
      ...linkedAssets.flatMap((a) => [a.name, a.name_ja]),
      ...v.linkedRoutes.flatMap((r) => [r.name, r.name_ja]),
    ].filter(Boolean));
    const ctx = { asof, event: { ...e, name: eventName(e.title) }, linkedAssets, linkedRoutes: v.linkedRoutes, gazetteer, allowedPlaces };
    // 언어마다 따로 생성한다. 번역이 아니라 각 언어로 쓰게 해야 가드가 제 언어로 작동한다.
    // 같은 이벤트라도 한쪽 언어만 가드를 통과할 수 있다 — 통과한 쪽만 발행된다.
    for (const lang of langs) {
      const prose = await narrateEventImpact(callLLM, ctx, { lang });
      if (prose.needs_editor) res.needsEditor++;
      const row = mapEventRow(ctx, prose, asof, lang);
      currentKeys.add(`${row.metric_ref}|${lang}`);
      if (dryRun) { console.log(`· [dry:${row.status}:${lang}] ${row.metric_ref} (${ctx.event.name})`); continue; }
      const { data: existing } = await supabase.from('forecasts').select('id,status')
        .eq('metric_ref', row.metric_ref).eq('model_version', MODEL_VERSION).eq('lang', lang).limit(1);
      let error = null, action = 'insert';
      if (existing && existing.length) {
        if (existing[0].status !== 'draft') { res.skippedExisting++; continue; }
        action = 'update';
        ({ error } = await supabase.from('forecasts').update(row).eq('id', existing[0].id));
      } else {
        ({ error } = await supabase.from('forecasts').insert(row));
      }
      if (error) { res.errors++; console.error(`❌ ${action} [${row.metric_ref}:${lang}]: ${error.message}`); }
      else { action === 'update' ? res.updated++ : res.inserted++; console.log(`✅ ${row.status} [${row.metric_ref}:${lang}] ${ctx.event.name}`); }
    }
  }

  // purge: 이번에 재생성 안 된 climate:event draft만 삭제(다른 climate 키 불간섭).
  if (!dryRun) {
    const { data: old } = await supabase.from('forecasts').select('id,metric_ref,lang').eq('module', 'climate').eq('status', 'draft').like('metric_ref', 'climate:event:%');
    // 언어별로 판단한다. metric_ref만 보면 한쪽 언어만 재생성돼도 다른 쪽이 살아남는다.
    for (const d of (old || []).filter((x) => !currentKeys.has(`${x.metric_ref}|${x.lang || 'ko'}`))) {
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
  // --lang=ja 로 한쪽만 돌릴 수 있다. 한국어가 이미 발행돼 있는데 두 언어를 다
  // 돌리면 LLM 호출만 두 배로 쓰고 한국어는 skippedExisting으로 버려진다.
  const langArg = process.argv.find((a) => a.startsWith('--lang='));
  const langs = langArg ? langArg.split('=')[1].split(',').filter(Boolean) : ['ko', 'ja'];
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('SUPABASE 환경변수 없음');
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY 미설정');
  const { createClient } = require('@supabase/supabase-js');
  const { callClaude } = require('../forecast/llm');
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false }, realtime: { enabled: false } });
  const res = await generateEventDrafts(supabase, callClaude, { dryRun, langs });
  console.log(`📊 lang ${langs.join(',')} · events ${res.events} · linked ${res.linked} · 신규 ${res.inserted} · 갱신 ${res.updated} · 보존 ${res.skippedExisting} · 폐기 ${res.purged} · 에디터필요 ${res.needsEditor} · 오류 ${res.errors}${dryRun ? ' (DRY RUN)' : ''}`);
}
if (require.main === module) main().catch((e) => { console.error('climate-event generate 실패:', e.message); process.exit(1); });
module.exports = { generateEventDrafts };
