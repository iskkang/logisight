'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { eventPassageHits, judgeEvents } = require('./judge');

// 실제 시드 좌표(lat,lon,radius)
const PASSAGES = [
  { id: 'taiwan_strait', lat: 24.0, lon: 119.5, influence_radius_km: 180 },
  { id: 'miyako_strait', lat: 24.8, lon: 125.3, influence_radius_km: 150 },
  { id: 'bashi_channel', lat: 21.5, lon: 121.0, influence_radius_km: 180 },
];

// MEKKHALA: 현재점(125.6,18.5)에서 미야코해협(125.3,24.8) 인근 지나 북동진(실 트랙 축약).
const MEKKHALA = { id: 'hko-2611', kind: 'cyclone', lon: 125.6, lat: 18.5,
  track: [[125.6, 18.5], [125.3, 21.0], [125.3, 24.7], [128, 28], [135, 33]] };

test('eventPassageHits: 트랙이 미야코해협만 hit(대만해협·바시는 미스)', () => {
  const hits = eventPassageHits(MEKKHALA, PASSAGES);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].passage_id, 'miyako_strait');
  assert.ok(hits[0].min_dist_km < 150);
  assert.equal(hits[0].hit_point_idx, 2); // [125.3,24.7]이 최근접
});

test('eventPassageHits: 단일점(트랙 없음)은 아무것도 못 잡음 — (b)의 존재 이유', () => {
  const single = { ...MEKKHALA, track: null };
  assert.deepEqual(eventPassageHits(single, PASSAGES), []);
});

test('eventPassageHits: 비-cyclone 점 이벤트는 단일좌표로 판정', () => {
  const flood = { id: 'fl', kind: 'flood', lon: 125.35, lat: 24.85, track: null };
  const hits = eventPassageHits(flood, PASSAGES);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].passage_id, 'miyako_strait');
});

test('eventPassageHits: 같은 passage 여러 점 걸려도 1행(최소거리)', () => {
  const ev = { id: 'x', kind: 'cyclone', lon: 125.3, lat: 24.7, track: [[125.3, 24.7], [125.3, 24.85], [125.3, 24.6]] };
  const hits = eventPassageHits(ev, PASSAGES).filter((h) => h.passage_id === 'miyako_strait');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].hit_point_idx, 1); // [125.3,24.85]가 24.8에 가장 가까움
});

test('eventPassageHits: 좌표 없고 트랙도 없으면 빈 배열(무크래시)', () => {
  assert.deepEqual(eventPassageHits({ id: 'z', kind: 'flood', lon: null, lat: null, track: null }, PASSAGES), []);
});

// ── orchestration ──
function fakeSupabase({ events, captured }) {
  const data = { events, passages: PASSAGES };
  function from(table) {
    let rows = (data[table] || []).slice();
    const api = {
      select() { return api; },
      delete() { return { gte() { captured.push({ op: 'deleteAll' }); return Promise.resolve({ error: null }); } }; },
      upsert(r) { captured.push({ op: 'upsert', rows: r }); return Promise.resolve({ error: null }); },
      then(res, rej) { return Promise.resolve({ data: rows }).then(res, rej); },
    };
    return api;
  }
  return { from };
}

test('judgeEvents: 활성 이벤트 판정 → delete-before-insert 후 hit upsert', async () => {
  const captured = [];
  const sb = fakeSupabase({ events: [MEKKHALA], captured });
  const res = await judgeEvents(sb, { dryRun: false });
  assert.ok(captured.some((c) => c.op === 'deleteAll')); // stale 제거
  const up = captured.find((c) => c.op === 'upsert');
  assert.ok(up && up.rows.length === 1);
  assert.equal(up.rows[0].passage_id, 'miyako_strait');
  assert.equal(up.rows[0].event_id, 'hko-2611');
  assert.equal(res.hits, 1);
});

test('judgeEvents: dryRun이면 DB 쓰지 않고 hit 행 반환', async () => {
  const captured = [];
  const sb = fakeSupabase({ events: [MEKKHALA], captured });
  const res = await judgeEvents(sb, { dryRun: true });
  assert.equal(captured.length, 0);
  assert.equal(res.rows.length, 1);
  assert.equal(res.rows[0].passage_id, 'miyako_strait');
});
