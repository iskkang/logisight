'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { generateEventDrafts } = require('./generate');

// Stub LLM: returns valid JSON so narrate guards pass
const GOOD_LLM = async () => JSON.stringify({
  weather: '북서태평양 경보 태풍이 상하이 항 인근 200km 이내로 접근하고 있다.',
  impact: '상하이 항 기항 노선에 리드타임 지연이 추정된다. +1~3일 수준.',
  action: '상하이 항 기항 부킹에 버퍼를 두고 태풍 트랙 갱신을 모니터링할 것을 권고한다.',
  event_echo: '태풍 이벤트',
});

// Event ON an asset (lon/lat within 200 km of shanghai_port)
const EVENT_ON_ASSET = {
  id: 'ev-001',
  source: 'test',
  kind: 'cyclone',
  title: '태풍 이벤트 (Red)',
  severity: 'r',
  lon: 121.5,
  lat: 31.2,
  area: '동중국해',
  track: null,
};

// Event far from all assets (middle of ocean, no assets within 200km)
const EVENT_FAR = {
  id: 'ev-002',
  source: 'test',
  kind: 'cyclone',
  title: '원거리 태풍 (Red)',
  severity: 'r',
  lon: 160.0,
  lat: 10.0,
  area: '서태평양',
  track: null,
};

const ASSETS = [
  { id: 'shanghai_port', name: '상하이 항', type: 'port', lon: 121.5, lat: 31.2 },
];

const ROUTES = [];

// ─── fake supabase helpers ────────────────────────────────────────────────────
function match(r, f) { return Object.entries(f).every(([k, v]) => r[k] === v); }
function matchLike(r, c, pattern) {
  // supports 'climate:event:%' pattern (prefix match)
  const prefix = pattern.replace(/%$/, '');
  return String(r[c] || '').startsWith(prefix);
}

function forecastsBuilder(store, captured) {
  const filters = {};
  let likeFilter = null;
  const b = {
    select() { return b; },
    eq(c, v) { filters[c] = v; return b; },
    like(c, pattern) { likeFilter = { c, pattern }; return b; },
    limit() {
      let rows = store.filter((r) => match(r, filters));
      if (likeFilter) rows = rows.filter((r) => matchLike(r, likeFilter.c, likeFilter.pattern));
      return Promise.resolve({ data: rows });
    },
    then(res, rej) {
      let rows = store.filter((r) => match(r, filters));
      if (likeFilter) rows = rows.filter((r) => matchLike(r, likeFilter.c, likeFilter.pattern));
      return Promise.resolve({ data: rows }).then(res, rej);
    },
    insert(row) {
      store.push({ ...row, id: 'fc-' + (store.length + 1) });
      captured.push({ op: 'insert', metric_ref: row.metric_ref, lang: row.lang, statement: row.statement });
      return Promise.resolve({ error: null });
    },
    update(row) {
      return {
        eq(c, v) {
          const i = store.findIndex((r) => r[c] === v);
          if (i >= 0) store[i] = { ...store[i], ...row };
          captured.push({ op: 'update', metric_ref: row.metric_ref, lang: row.lang });
          return Promise.resolve({ error: null });
        },
      };
    },
    delete() {
      return {
        eq(c, v) {
          const i = store.findIndex((r) => r[c] === v);
          const rm = i >= 0 ? store.splice(i, 1)[0] : null;
          captured.push({ op: 'delete', metric_ref: rm && rm.metric_ref });
          return Promise.resolve({ error: null });
        },
      };
    },
  };
  return b;
}

function fakeSupabase({ events, assets = ASSETS, routes = ROUTES, risk = [], existingForecasts = [], captured }) {
  const store = existingForecasts.slice();
  const tableData = {
    events,
    assets,
    routes,
    asset_risk: risk,
  };
  function from(table) {
    if (table === 'forecasts') return forecastsBuilder(store, captured);
    const rows = (tableData[table] || []).slice();
    const api = {
      select() { return api; },
      eq() { return api; },
      in() { return api; },
      order() { return api; },
      limit() { return Promise.resolve({ data: rows }); },
      then(res, rej) { return Promise.resolve({ data: rows }).then(res, rej); },
    };
    return api;
  }
  return { from, _store: store };
}
// ─────────────────────────────────────────────────────────────────────────────

test('generateEventDrafts: 한 이벤트에서 언어별로 1건씩 insert된다', async () => {
  const captured = [];
  const res = await generateEventDrafts(
    fakeSupabase({ events: [EVENT_ON_ASSET], captured }),
    GOOD_LLM,
    { asof: new Date('2026-06-30') },
  );
  assert.equal(res.linked, 1, 'linked 1건이어야 함');
  assert.equal(res.inserted, 2, 'ko·ja 각 1건');
  const inserts = captured.filter((c) => c.op === 'insert');
  assert.deepEqual(inserts.map((c) => c.lang).sort(), ['ja', 'ko']);
  assert.ok(inserts.every((c) => c.metric_ref === 'climate:event:ev-001'), 'metric_ref 일치 확인');
});

// langs를 좁히면 그 언어만 나와야 한다. 한국 파이프라인만 돌릴 때 쓰는 경로다.
test('generateEventDrafts: langs로 생성 언어를 좁힐 수 있다', async () => {
  const captured = [];
  const res = await generateEventDrafts(
    fakeSupabase({ events: [EVENT_ON_ASSET], captured }),
    GOOD_LLM,
    { asof: new Date('2026-06-30'), langs: ['ko'] },
  );
  assert.equal(res.inserted, 1);
  assert.equal(captured.find((c) => c.op === 'insert').lang, 'ko');
});

test('generateEventDrafts: 자산에서 먼 LIMITED 이벤트 → forecasts 미생성', async () => {
  const captured = [];
  const res = await generateEventDrafts(
    fakeSupabase({ events: [EVENT_FAR], captured }),
    GOOD_LLM,
    { asof: new Date('2026-06-30') },
  );
  assert.equal(res.linked, 0, 'linked 0건이어야 함');
  assert.equal(res.inserted, 0, 'insert 없어야 함');
  assert.ok(!captured.some((c) => c.op === 'insert'), 'insert 없음 확인');
});

test('generateEventDrafts: dryRun이면 DB 미기록', async () => {
  const captured = [];
  const res = await generateEventDrafts(
    fakeSupabase({ events: [EVENT_ON_ASSET], captured }),
    GOOD_LLM,
    { asof: new Date('2026-06-30'), dryRun: true },
  );
  assert.equal(captured.length, 0, 'dryRun에서 DB 조작 없어야 함');
  assert.equal(res.inserted, 0);
  assert.equal(res.purged, 0);
});

test('generateEventDrafts: purge는 climate:event:% 스코프만 삭제, 다른 climate 키 보존', async () => {
  const captured = [];
  const existingForecasts = [
    { id: 'stale1', metric_ref: 'climate:event:old-ev', model_version: 'climate-event-v1', module: 'climate', status: 'draft' },
    { id: 'keep1', metric_ref: 'climate:r3:hko-2611:miyako_strait', model_version: 'climate-v1', module: 'climate', status: 'draft' },
  ];
  await generateEventDrafts(
    fakeSupabase({ events: [EVENT_ON_ASSET], existingForecasts, captured }),
    GOOD_LLM,
    { asof: new Date('2026-06-30') },
  );
  // stale climate:event:old-ev should be purged (not in currentKeys)
  assert.ok(captured.some((c) => c.op === 'delete' && c.metric_ref === 'climate:event:old-ev'), 'stale event draft 폐기');
  // climate:r3:... should NOT be deleted (different scope)
  assert.ok(!captured.some((c) => c.op === 'delete' && c.metric_ref === 'climate:r3:hko-2611:miyako_strait'), 'route draft 보존');
});

// 기존 행은 마이그레이션 기본값으로 lang='ko'가 된다. 이 상태에서 돌리면
// 한국어는 갱신되고 일본어는 새로 들어와야 한다 — 마이그레이션 직후의 실제 모습이다.
test('generateEventDrafts: 기존 ko draft는 update, 없는 ja는 insert', async () => {
  const captured = [];
  const existingForecasts = [
    { id: 'fc-draft', metric_ref: 'climate:event:ev-001', model_version: 'climate-event-v1', module: 'climate', status: 'draft', lang: 'ko' },
  ];
  const res = await generateEventDrafts(
    fakeSupabase({ events: [EVENT_ON_ASSET], existingForecasts, captured }),
    GOOD_LLM,
    { asof: new Date('2026-06-30') },
  );
  assert.equal(res.updated, 1, 'ko draft는 update');
  assert.equal(res.inserted, 1, 'ja는 신규 insert');
  assert.equal(captured.find((c) => c.op === 'insert').lang, 'ja');
});

// 발행된 행은 불변이다(트리거). 언어별로 판단하지 않으면 한쪽 언어 때문에 다른 쪽이 막힌다.
test('generateEventDrafts: 발행된 ko는 건너뛰고 ja만 새로 넣는다', async () => {
  const captured = [];
  const existingForecasts = [
    { id: 'fc-pub', metric_ref: 'climate:event:ev-001', model_version: 'climate-event-v1', module: 'climate', status: 'published', lang: 'ko' },
  ];
  const res = await generateEventDrafts(
    fakeSupabase({ events: [EVENT_ON_ASSET], existingForecasts, captured }),
    GOOD_LLM,
    { asof: new Date('2026-06-30') },
  );
  assert.equal(res.skippedExisting, 1);
  assert.equal(res.inserted, 1);
  assert.equal(captured.find((c) => c.op === 'insert').lang, 'ja');
});
