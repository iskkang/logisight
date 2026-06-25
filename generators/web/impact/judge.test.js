'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { eventPassageHits, judgeEvents, eventRadiusKm } = require('./judge');

// 실제 시드 좌표(lat,lon,radius)
const PASSAGES = [
  { id: 'taiwan_strait', lat: 24.0, lon: 119.5, influence_radius_km: 180 },
  { id: 'miyako_strait', lat: 24.8, lon: 125.3, influence_radius_km: 150 },
  { id: 'bashi_channel', lat: 21.5, lon: 121.0, influence_radius_km: 180 },
];

// ── 지진·쓰나미: 이벤트 구동 광역반경(점 이벤트는 passage 고정반경 대신 이벤트 심각도로 판정) ──
test('eventRadiusKm: 지진·쓰나미만 이벤트반경, 그 외 0(무회귀)', () => {
  assert.equal(eventRadiusKm({ kind: 'earthquake', severity: 'r' }), 350);
  assert.equal(eventRadiusKm({ kind: 'earthquake', severity: 'a' }), 150);
  assert.equal(eventRadiusKm({ kind: 'tsunami', severity: 'r' }), 1000);
  assert.equal(eventRadiusKm({ kind: 'tsunami', severity: 'a' }), 500);
  assert.equal(eventRadiusKm({ kind: 'cyclone', severity: 'r' }), 0);
  assert.equal(eventRadiusKm({ kind: 'flood', severity: 'a' }), 0);
});

test('eventPassageHits: 지진(red)은 이벤트 광역반경으로 passage 고정반경 밖도 hit', () => {
  // 진앙을 bashi_channel(21.5,121.0) 정남쪽 ~255km(2.3°lat): passage 180km 밖, 지진 red 350km 안.
  const quake = { id: 'gdacs:eq1', kind: 'earthquake', severity: 'r', lon: 121.0, lat: 19.2, track: null };
  const hit = eventPassageHits(quake, PASSAGES).find((h) => h.passage_id === 'bashi_channel');
  assert.ok(hit, 'bashi_channel이 지진 광역반경으로 잡혀야 함');
  assert.ok(hit.min_dist_km > 180 && hit.min_dist_km < 350);
});

test('eventPassageHits: 같은 거리의 홍수(점)는 passage 고정반경 밖이라 미스 — 이벤트반경 무적용', () => {
  const flood = { id: 'fl', kind: 'flood', severity: 'r', lon: 121.0, lat: 19.2, track: null };
  const hit = eventPassageHits(flood, PASSAGES).find((h) => h.passage_id === 'bashi_channel');
  assert.equal(hit, undefined);
});

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
