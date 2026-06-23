'use strict';
// (b) 이벤트 × passages 교차판정. cyclone은 예보트랙 점열, 그 외는 단일좌표.
// 각 (점 × passage) 대권거리 ≤ passage.influence_radius_km 이면 hit. passage별 최소거리 1행.
// 결과 → event_passage_hits(통째 재계산 교체). asset_risk 가산·forecast(c)·프론트는 범위 아님.
const path = require('path');

const R_KM = 6371;
const rad = (d) => (d * Math.PI) / 180;
function haversineKm(a, b) { // a,b: [lon,lat]
  const dLat = rad(b[1] - a[1]), dLon = rad(b[0] - a[0]);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * R_KM * Math.asin(Math.min(1, Math.sqrt(s)));
}

// 판정 점열: cyclone+트랙 있으면 트랙, 아니면 단일좌표(있을 때). 좌표·트랙 모두 없으면 빈 점열.
function eventPoints(event) {
  if (event.kind === 'cyclone' && Array.isArray(event.track) && event.track.length) return event.track;
  if (event.lon != null && event.lat != null) return [[event.lon, event.lat]];
  return [];
}

// event × passages → [{passage_id, min_dist_km, hit_point_idx}] (hit만, 최소거리 오름차순)
function eventPassageHits(event, passages) {
  const pts = eventPoints(event);
  if (!pts.length) return [];
  const hits = [];
  for (const p of passages) {
    let best = Infinity, bi = -1;
    pts.forEach((pt, i) => { const d = haversineKm(pt, [p.lon, p.lat]); if (d < best) { best = d; bi = i; } });
    if (best <= p.influence_radius_km) hits.push({ passage_id: p.id, min_dist_km: best, hit_point_idx: bi });
  }
  return hits.sort((a, b) => a.min_dist_km - b.min_dist_km);
}

// 전체 활성 이벤트 판정 → event_passage_hits 통째 교체(파생 테이블이므로 stale 없음).
async function judgeEvents(supabase, { dryRun = false } = {}) {
  const [{ data: events }, { data: passages }] = await Promise.all([
    supabase.from('events').select('id,kind,lon,lat,track'),
    supabase.from('passages').select('id,lon,lat,influence_radius_km'),
  ]);
  const rows = [];
  for (const e of events || []) {
    for (const h of eventPassageHits(e, passages || [])) {
      rows.push({ event_id: e.id, passage_id: h.passage_id, min_dist_km: Math.round(h.min_dist_km * 10) / 10, hit_point_idx: h.hit_point_idx, nearest_at: null });
    }
  }
  const res = { events: (events || []).length, hits: rows.length, rows };
  if (dryRun) return res;
  // 통째 재계산 교체: 가드 필터(created_at ≥ epoch)로 전체 삭제 후 재적재.
  await supabase.from('event_passage_hits').delete().gte('created_at', '1970-01-01T00:00:00Z');
  if (rows.length) {
    const { error } = await supabase.from('event_passage_hits').upsert(rows, { onConflict: 'event_id,passage_id' });
    if (error) throw new Error(error.message);
  }
  return res;
}

async function main() {
  require('dotenv').config({ path: path.resolve(__dirname, '../../../.env.local') });
  if (typeof globalThis.WebSocket === 'undefined') { try { globalThis.WebSocket = require('ws'); } catch (_) {} }
  const dryRun = process.argv.includes('--dry-run');
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('SUPABASE 환경변수 없음');
  const { createClient } = require('@supabase/supabase-js');
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false }, realtime: { enabled: false } });
  const res = await judgeEvents(supabase, { dryRun });
  console.log(`📊 이벤트 ${res.events} · passage hit ${res.hits}${dryRun ? ' (DRY RUN — 미적재)' : ''}`);
  if (dryRun) res.rows.forEach((r) => console.log(`· ${r.event_id} → ${r.passage_id} ${r.min_dist_km}km @pt#${r.hit_point_idx}`));
}

if (require.main === module) {
  main().catch((e) => { console.error('impact judge 실패:', e.message); process.exit(1); });
}

module.exports = { eventPassageHits, judgeEvents, haversineKm, eventPoints };
