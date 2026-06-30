'use strict';
// 기후 영향 AI 초안 생성 — 입력 = event_route_impacts(트랙 교차 검증된 event→route via passage).
// 거리-근접 로직 폐기. 실행: node generators/web/climate/generate.js [--dry-run]
// Phase-6 확장 — forecast/llm.js(callClaude) 재사용. 초안은 자동 발행 안 함(에디터 검수 후 발행).
const path = require('path');
const { narrateClimate } = require('./narrate');
const { mapClimateRow } = require('./row');

const MODEL_VERSION = 'climate-v1';
const R_KM = 6371;
const rad = (d) => (d * Math.PI) / 180;
function haversineKm(a, b) {
  const dLat = rad(b[1] - a[1]), dLon = rad(b[0] - a[0]);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * R_KM * Math.asin(Math.min(1, Math.sqrt(s)));
}
function eventName(title) { return String(title || '').replace(/\s*\(.*\)\s*$/, '').trim() || '이벤트'; }
// 트랙 진행 방향(점별 시각 없음 → 기하학적 방향만). cur·end: [lon,lat]
function direction(cur, end) {
  if (!cur || !end) return '정체';
  const dLat = end[1] - cur[1], dLon = end[0] - cur[0];
  const ns = dLat > 2 ? '북' : dLat < -2 ? '남' : '', ew = dLon > 2 ? '동' : dLon < -2 ? '서' : '';
  return (ns + ew) ? (ns + ew + '진') : '정체';
}
// 트랙 요약(예보시각 미제공 — 방향·관문통과·끝점만). via_passage 인근 점을 통과지점으로.
function trackSummary(event, viaPassage) {
  const track = Array.isArray(event.track) ? event.track : null;
  if (!track || !track.length) return { hasTrack: false, current: event.lon != null ? [event.lon, event.lat] : null };
  let best = Infinity, bi = 0;
  track.forEach((p, i) => { const d = haversineKm(p, [viaPassage.lon, viaPassage.lat]); if (d < best) { best = d; bi = i; } });
  return { hasTrack: true, current: track[0], via: track[bi], end: track[track.length - 1], direction: direction(track[0], track[track.length - 1]), points: track.length };
}

// 핵심 루프 — supabase/callLLM 주입(테스트 가능).
async function generateClimateDrafts(supabase, callLLM, { asof = new Date(), dryRun = false } = {}) {
  const [{ data: impacts }, { data: events }, { data: routes }, { data: passages }, { data: assets }, { data: risk }] = await Promise.all([
    supabase.from('event_route_impacts').select('event_id,route_id,via_passage_id,min_dist_km'),
    supabase.from('events').select('id,source,kind,title,severity,lon,lat,area,track'),
    supabase.from('routes').select('id,name'),
    supabase.from('passages').select('id,name_ko,lat,lon,influence_radius_km'),
    supabase.from('assets').select('id,name,type,lon,lat'),
    supabase.from('asset_risk').select('asset_id,horizon_days,score,level,driver'),
  ]);
  const eventById = {}; (events || []).forEach((e) => { eventById[e.id] = e; });
  const routeById = {}; (routes || []).forEach((r) => { routeById[r.id] = r; });
  const passageById = {}; (passages || []).forEach((p) => { passageById[p.id] = p; });
  const riskH0 = {}; (risk || []).forEach((r) => { if (r.horizon_days === 0) riskH0[r.asset_id] = r; });
  // 환각 가드(2b)용 gazetteer: 알려진 관문·자산 지명 전체. via 인근(≤1500km) + event.area만 allowed.
  const gazetteer = [...(passages || []).map((p) => p.name_ko), ...(assets || []).map((a) => a.name)].filter(Boolean);
  const ALLOW_KM = 1500;

  // 같은 관문(via)을 공유하는 route 목록(전파 맥락).
  const routesByVia = {};
  for (const im of impacts || []) (routesByVia[im.via_passage_id] = routesByVia[im.via_passage_id] || new Set()).add(im.route_id);

  // (event, route) 그룹 → 최근접 via 대표(동일 route 중복 초안 방지).
  const groups = new Map();
  for (const im of impacts || []) {
    const key = `${im.event_id}|${im.route_id}`;
    let g = groups.get(key);
    if (!g) { g = { event_id: im.event_id, route_id: im.route_id, vias: [] }; groups.set(key, g); }
    g.vias.push({ via: im.via_passage_id, min: im.min_dist_km });
  }

  const res = { impacts: (impacts || []).length, groups: groups.size, inserted: 0, updated: 0, skippedExisting: 0, needsEditor: 0, errors: 0, purged: 0, drafts: [] };
  const currentKeys = new Set();

  for (const g of groups.values()) {
    g.vias.sort((a, b) => a.min - b.min);
    const primary = g.vias[0];
    const event = eventById[g.event_id], route = routeById[g.route_id], viaPassage = passageById[primary.via];
    if (!event || !route || !viaPassage) { console.log(`↩︎ skip ${g.event_id}|${g.route_id} — 메타 결손`); continue; }
    const shared = [...(routesByVia[primary.via] || [])].filter((rid) => rid !== route.id).map((rid) => routeById[rid]).filter(Boolean).map((r) => ({ id: r.id, name: r.name }));
    const ts = trackSummary(event, viaPassage);
    const near = (assets || [])
      .map((a) => ({ asset: a, km: haversineKm([viaPassage.lon, viaPassage.lat], [a.lon, a.lat]) }))
      .filter((x) => x.km <= 800).sort((a, b) => a.km - b.km).slice(0, 3)
      .map((x) => ({ name: x.asset.name, type: x.asset.type, km: x.km, risk: riskH0[x.asset.id] || null }));
    const allowedPlaces = new Set([viaPassage.name_ko, event.area].filter(Boolean));
    for (const p of passages || []) if (haversineKm([viaPassage.lon, viaPassage.lat], [p.lon, p.lat]) <= ALLOW_KM) allowedPlaces.add(p.name_ko);
    for (const a of assets || []) if (haversineKm([viaPassage.lon, viaPassage.lat], [a.lon, a.lat]) <= ALLOW_KM) allowedPlaces.add(a.name);
    const ctx = { asof, event: { ...event, name: eventName(event.title) }, route: { id: route.id, name: route.name }, viaPassage, viaMinKm: primary.min, sharedRoutes: shared, trackSummary: ts, nearbyAssets: near, gazetteer, allowedPlaces };

    const prose = await narrateClimate(callLLM, ctx);
    if (prose.needs_editor) res.needsEditor++;
    const row = mapClimateRow(ctx, prose, asof);
    currentKeys.add(row.metric_ref);
    res.drafts.push({ ctx, row });

    if (dryRun) { console.log(`· [dry:${row.status}] ${row.metric_ref} (${ctx.event.name} → ${route.name} via ${viaPassage.name_ko})${prose.needs_editor ? ' (에디터 작성 필요)' : ''}`); continue; }

    // dedup: 같은 (metric_ref, model_version) — 발행/판정 보존, draft만 갱신.
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
    else { if (action === 'update') res.updated++; else res.inserted++; console.log(`✅ ${row.status} [${row.metric_ref}] ${ctx.event.name} → ${route.name} via ${viaPassage.name_ko}`); }
  }

  // 폐기: 이번에 재생성되지 않은 climate draft(거리-근접 stale, 더 이상 영향 없는 이벤트)는 삭제. 발행/판정은 보존(불변).
  if (!dryRun) {
    const { data: old } = await supabase.from('forecasts').select('id,metric_ref').eq('module', 'climate').eq('status', 'draft');
    // climate:event:%(이벤트-자산 생성기 소관)는 이 route-centric purge에서 제외 — 교차삭제 방지.
    for (const d of (old || []).filter((x) => !currentKeys.has(x.metric_ref) && !String(x.metric_ref).startsWith('climate:event:'))) {
      const { error } = await supabase.from('forecasts').delete().eq('id', d.id);
      if (!error) { res.purged++; console.log(`🗑️ purge stale [${d.metric_ref}]`); }
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
  const res = await generateClimateDrafts(supabase, callClaude, { dryRun });
  console.log(`📊 impacts ${res.impacts} · 그룹 ${res.groups} · 신규 ${res.inserted} · 갱신 ${res.updated} · 보존 ${res.skippedExisting} · 폐기 ${res.purged} · 에디터필요 ${res.needsEditor} · 오류 ${res.errors}${dryRun ? ' (DRY RUN — 미적재)' : ''}`);
}

if (require.main === module) {
  main().catch((e) => { console.error('climate generate 실패:', e.message); process.exit(1); });
}

module.exports = { generateClimateDrafts, trackSummary, direction };
