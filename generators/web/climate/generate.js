'use strict';
// 기후 영향 AI 초안 생성: 활성 events × 노선 근접 → Claude 3단 초안 → forecasts(module='climate', status='draft').
// 실행: node generators/web/climate/generate.js [--dry-run]
// 신호: asset_risk score(평시 기상장)만이 아니라 활성 이벤트+근접을 1차 신호로 둔다(narrate 프롬프트에 명시).
// Phase-6 확장 — forecast/llm.js(callClaude) 재사용. 초안은 자동 발행하지 않음(에디터 검수 후 발행).
const path = require('path');
const { proximateRoutes, nearbyAssets } = require('./proximity');
const { narrateClimate } = require('./narrate');
const { mapClimateRow } = require('./row');

const THRESHOLD_KM = 1000;        // 프론트와 공유하는 근접 임계
const MODEL_VERSION = 'climate-v1';

// 이벤트 선별: 점좌표 보유 + 태풍·홍수(스펙 명시 대상)만. storm/snow/other(토네이도·산불 등) 제외.
// 다발 경보(지역 홍수 등) 노이즈는 (노선×종류) 최근접 1건만 채택해 억제한다.
function qualifies(e) {
  return e.lon != null && e.lat != null && (e.kind === 'cyclone' || e.kind === 'flood');
}
function eventName(title) { return String(title || '').replace(/\s*\(.*\)\s*$/, '').trim() || '이벤트'; }

// 핵심 루프 — supabase/callLLM 주입(테스트 가능).
async function generateClimateDrafts(supabase, callLLM, { asof = new Date(), dryRun = false, thresholdKm = THRESHOLD_KM } = {}) {
  const [{ data: events }, { data: routes }, { data: assets }, { data: risk }] = await Promise.all([
    supabase.from('events').select('id,source,kind,title,severity,lon,lat,area,starts_at,ends_at'),
    supabase.from('routes').select('id,name,waypoints,chokes'),
    supabase.from('assets').select('id,name,type,lon,lat,freeze_prone'),
    supabase.from('asset_risk').select('asset_id,horizon_days,score,level,driver'),
  ]);
  const assetById = {}; (assets || []).forEach((a) => { assetById[a.id] = a; });
  const riskH0 = {}; (risk || []).forEach((r) => { if (r.horizon_days === 0) riskH0[r.asset_id] = r; });

  // 근접 (이벤트×노선) 쌍 → (노선id, 종류)별 최근접 1건만 유지(중복 경보 억제).
  const best = new Map(); // key: route.id|kind → {event, route, km, label}
  for (const e of (events || []).filter(qualifies)) {
    for (const pr of proximateRoutes(e, routes || [], assetById, thresholdKm)) {
      const key = `${pr.route.id}|${e.kind}`;
      const cur = best.get(key);
      if (!cur || pr.km < cur.km) best.set(key, { event: e, route: pr.route, km: pr.km, label: pr.label });
    }
  }
  const pairs = [...best.values()];
  const res = { events: (events || []).length, pairs: pairs.length, inserted: 0, updated: 0, skippedExisting: 0, needsEditor: 0, errors: 0, drafts: [] };
  if (!pairs.length) { console.log('근접 이벤트 0건 → 생성 스킵(빈 초안 금지)'); return res; }

  for (const p of pairs) {
    const near = nearbyAssets(p.event, assets || [], thresholdKm)
      .slice(0, 6)
      .map((x) => ({ name: x.asset.name, type: x.asset.type, km: x.km, risk: riskH0[x.asset.id] || null }));
    const ctx = { asof, event: { ...p.event, name: eventName(p.event.title) }, route: p.route, nearestKm: p.km, nearestLabel: p.label, nearbyAssets: near };
    const prose = await narrateClimate(callLLM, ctx);
    if (prose.needs_editor) res.needsEditor++;
    const row = mapClimateRow(ctx, prose, asof);
    res.drafts.push({ ctx, row });

    if (dryRun) { console.log(`· [dry] ${row.metric_ref} ${prose.needs_editor ? '(에디터 작성 필요)' : ''}`); continue; }

    // dedup: 같은 (metric_ref, model_version) — 발행/판정된 행은 보존, draft만 갱신.
    const { data: existing } = await supabase.from('forecasts').select('id,status')
      .eq('metric_ref', row.metric_ref).eq('model_version', MODEL_VERSION).limit(1);
    let error = null, action = 'insert';
    if (existing && existing.length) {
      if (existing[0].status !== 'draft') { res.skippedExisting++; console.log(`↩︎ skip [${row.metric_ref}] 이미 ${existing[0].status}`); continue; }
      action = 'update';
      ({ error } = await supabase.from('forecasts').update(row).eq('id', existing[0].id));
    } else {
      ({ error } = await supabase.from('forecasts').insert(row));
    }
    if (error) { res.errors++; console.error(`❌ ${action} [${row.metric_ref}]: ${error.message}`); }
    else { if (action === 'update') res.updated++; else res.inserted++; console.log(`✅ draft [${row.metric_ref}] ${ctx.event.name} × ${p.route.name}${prose.needs_editor ? ' (에디터 작성 필요)' : ''}`); }
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
  const res = await generateClimateDrafts(supabase, callClaude, { dryRun });
  console.log(`📊 이벤트 ${res.events} · 근접쌍 ${res.pairs} · 신규 ${res.inserted} · 갱신 ${res.updated} · 보존 ${res.skippedExisting} · 에디터필요 ${res.needsEditor} · 오류 ${res.errors}${dryRun ? ' (DRY RUN — 미적재)' : ''}`);
}

if (require.main === module) {
  main().catch((e) => { console.error('climate generate 실패:', e.message); process.exit(1); });
}

module.exports = { generateClimateDrafts };
