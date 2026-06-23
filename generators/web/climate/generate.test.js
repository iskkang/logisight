'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { generateClimateDrafts } = require('./generate');

const GOOD_LLM = async () => JSON.stringify({
  weather: 'MEKKHALA는 슈퍼태풍 강도로 북동진하며 미야코해협을 통과하는 것으로 나타났다. 트랙 점에 예보시각이 없어 시점은 단정하지 않는다.',
  impact: '아시아–미동안 노선이 미야코해협을 지나므로 통항·리드타임에 지연 가능성이 있다고 추정된다. +2~4일가량 추정 수준.',
  action: '미야코해협 경유 부킹에 버퍼를 두고 트랙 갱신을 모니터링할 것을 권고한다.',
  event_echo: 'MEKKHALA',
});

const EVENTS = [{ id: 'hko-2611', source: 'hko', kind: 'cyclone', title: 'MEKKHALA (Super Typhoon)', severity: 'r', lon: 125.6, lat: 18.5, area: '북서태평양', track: [[125.2, 18.9], [125.3, 24.7], [145.8, 36.9]] }];

function match(r, f) { return Object.entries(f).every(([k, v]) => r[k] === v); }
function forecastsBuilder(store, captured) {
  const filters = {};
  const b = {
    select() { return b; },
    eq(c, v) { filters[c] = v; return b; },
    limit() { return Promise.resolve({ data: store.filter((r) => match(r, filters)) }); },
    then(res, rej) { return Promise.resolve({ data: store.filter((r) => match(r, filters)) }).then(res, rej); },
    insert(row) { store.push({ ...row, id: 'fc-' + (store.length + 1) }); captured.push({ op: 'insert', metric_ref: row.metric_ref }); return Promise.resolve({ error: null }); },
    update(row) { return { eq(c, v) { const i = store.findIndex((r) => r[c] === v); if (i >= 0) store[i] = { ...store[i], ...row }; captured.push({ op: 'update', metric_ref: row.metric_ref }); return Promise.resolve({ error: null }); } }; },
    delete() { return { eq(c, v) { const i = store.findIndex((r) => r[c] === v); const rm = i >= 0 ? store.splice(i, 1)[0] : null; captured.push({ op: 'delete', metric_ref: rm && rm.metric_ref }); return Promise.resolve({ error: null }); } }; },
  };
  return b;
}
function fakeSupabase({ impacts, events = EVENTS, captured, existingForecasts = [] }) {
  const store = existingForecasts.slice();
  const data = {
    event_route_impacts: impacts,
    events,
    routes: [{ id: 'r3', name: '아시아–미동안' }, { id: 'r1', name: '아시아–유럽' }],
    passages: [{ id: 'miyako_strait', name_ko: '미야코해협', lat: 24.8, lon: 125.3, influence_radius_km: 150 }, { id: 'taiwan_strait', name_ko: '대만해협', lat: 24, lon: 119.5, influence_radius_km: 180 }],
    assets: [{ id: 'taiwan', name: '대만 해협', type: 'choke', lon: 119.5, lat: 24 }],
    asset_risk: [],
  };
  function from(table) {
    if (table === 'forecasts') return forecastsBuilder(store, captured);
    let rows = (data[table] || []).slice();
    const api = { select() { return api; }, eq() { return api; }, in() { return api; }, order() { return api; }, limit() { return Promise.resolve({ data: rows }); }, then(res, rej) { return Promise.resolve({ data: rows }).then(res, rej); } };
    return api;
  }
  return { from, _store: store };
}

test('generateClimateDrafts: event_route_impacts(r3 via miyako) → 1 draft, metric_ref에 via 포함', async () => {
  const captured = [];
  const impacts = [{ event_id: 'hko-2611', route_id: 'r3', via_passage_id: 'miyako_strait', min_dist_km: 100 }];
  const res = await generateClimateDrafts(fakeSupabase({ impacts, captured }), GOOD_LLM, { asof: new Date('2026-06-23') });
  assert.equal(res.inserted, 1);
  assert.equal(res.drafts.length, 1);
  assert.equal(res.drafts[0].row.metric_ref, 'climate:r3:hko-2611:miyako_strait');
  assert.equal(res.drafts[0].ctx.viaPassage.id, 'miyako_strait');
  assert.equal(res.drafts[0].ctx.trackSummary.hasTrack, true);
  assert.equal(res.drafts[0].ctx.trackSummary.direction, '북동진');
});

test('generateClimateDrafts: 거리-근접 stale draft(키 불일치)는 폐기, 발행분은 보존', async () => {
  const captured = [];
  const impacts = [{ event_id: 'hko-2611', route_id: 'r3', via_passage_id: 'miyako_strait', min_dist_km: 100 }];
  const existingForecasts = [
    { id: 'old1', metric_ref: 'climate:r3:hko-2611', model_version: 'climate-v1', module: 'climate', status: 'draft' }, // 거리근접 stale
    { id: 'pub1', metric_ref: 'climate:r9:e9', model_version: 'climate-v1', module: 'climate', status: 'published' },   // 보존
  ];
  const res = await generateClimateDrafts(fakeSupabase({ impacts, captured, existingForecasts }), GOOD_LLM, { asof: new Date('2026-06-23') });
  assert.equal(res.purged, 1);
  assert.ok(captured.some((c) => c.op === 'delete' && c.metric_ref === 'climate:r3:hko-2611'));
  assert.ok(!captured.some((c) => c.op === 'delete' && c.metric_ref === 'climate:r9:e9')); // published 보존
});

test('generateClimateDrafts: 0 impacts → 0 draft, stale draft 폐기', async () => {
  const captured = [];
  const existingForecasts = [{ id: 'old1', metric_ref: 'climate:r3:hko-2611', model_version: 'climate-v1', module: 'climate', status: 'draft' }];
  const res = await generateClimateDrafts(fakeSupabase({ impacts: [], captured, existingForecasts }), GOOD_LLM, { asof: new Date('2026-06-23') });
  assert.equal(res.groups, 0);
  assert.equal(res.drafts.length, 0);
  assert.equal(res.purged, 1);
});

test('generateClimateDrafts: 같은 (event,route) 다중 via → 1 draft(최근접 via 대표)', async () => {
  const captured = [];
  const impacts = [
    { event_id: 'hko-2611', route_id: 'r3', via_passage_id: 'taiwan_strait', min_dist_km: 150 },
    { event_id: 'hko-2611', route_id: 'r3', via_passage_id: 'miyako_strait', min_dist_km: 100 },
  ];
  const res = await generateClimateDrafts(fakeSupabase({ impacts, captured }), GOOD_LLM, { asof: new Date('2026-06-23') });
  assert.equal(res.groups, 1);
  assert.equal(res.drafts.length, 1);
  assert.equal(res.drafts[0].row.metric_ref, 'climate:r3:hko-2611:miyako_strait'); // 최근접 100km
});

test('generateClimateDrafts: dryRun이면 DB 미기록·폐기 안 함, 행만 반환', async () => {
  const captured = [];
  const impacts = [{ event_id: 'hko-2611', route_id: 'r3', via_passage_id: 'miyako_strait', min_dist_km: 100 }];
  const existingForecasts = [{ id: 'old1', metric_ref: 'climate:r3:hko-2611', model_version: 'climate-v1', module: 'climate', status: 'draft' }];
  const res = await generateClimateDrafts(fakeSupabase({ impacts, captured, existingForecasts }), GOOD_LLM, { asof: new Date('2026-06-23'), dryRun: true });
  assert.equal(captured.length, 0);
  assert.equal(res.drafts.length, 1);
  assert.equal(res.purged, 0);
});
