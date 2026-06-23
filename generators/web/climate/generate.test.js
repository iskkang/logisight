'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { generateClimateDrafts } = require('./generate');

const GOOD_LLM = async () => JSON.stringify({
  weather: 'MEKKHALA는 슈퍼태풍 강도로 대만 해협 인근에 위치한 것으로 나타났다. 예보 경로는 입력에 없어 접근 방향은 단정하지 않는다.',
  impact: '아시아–미동안 노선의 대만해협 구간에서 우회·감속 가능성이 있고 리드타임은 +2~4일가량 추정된다.',
  action: '대만해협 경유 부킹에 버퍼를 두고 선사 공지를 모니터링할 것을 권고한다.',
  event_echo: 'MEKKHALA',
});

// 가짜 supabase — 테이블별 데이터 + forecasts insert/update/lookup 캡처.
function fakeSupabase({ forecastsExisting = [], captured, events }) {
  const data = {
    events: events || [
      { id: 'hko-2611', source: 'hko', kind: 'cyclone', title: 'MEKKHALA (Super Typhoon)', severity: 'r', lon: 125.6, lat: 18.5, area: '북서태평양' },
      { id: 'gdacs:far', source: 'gdacs', kind: 'flood', title: 'Flood Far', severity: 'r', lon: -46.3, lat: -23.9, area: 'Brazil' },
    ],
    routes: [
      { id: 'r3', name: '아시아–미동안', waypoints: ['shanghai', 'taiwan', [140, 20]], chokes: ['taiwan'] },
      { id: 'r2', name: '환태평양', waypoints: ['busan', [150, 40]], chokes: [] },
    ],
    assets: [
      { id: 'taiwan', name: '대만 해협', type: 'choke', lon: 119.5, lat: 24.0, freeze_prone: false },
      { id: 'shanghai', name: '상하이', type: 'port', lon: 121.5, lat: 31.2, freeze_prone: false },
      { id: 'busan', name: '부산', type: 'port', lon: 129.0, lat: 35.1, freeze_prone: false },
    ],
    asset_risk: [{ asset_id: 'taiwan', horizon_days: 0, score: 0, level: 'g', driver: '평온' }],
    forecasts: forecastsExisting,
  };
  function from(table) {
    let rows = (data[table] || []).slice();
    const api = {
      select() { return api; },
      eq(col, val) { rows = rows.filter((r) => r[col] === val); return api; },
      in(col, vals) { rows = rows.filter((r) => vals.includes(r[col])); return api; },
      order() { return api; },
      limit() { return Promise.resolve({ data: rows }); },
      then(res, rej) { return Promise.resolve({ data: rows }).then(res, rej); },
      async insert(row) { captured.push({ op: 'insert', row }); return { error: null }; },
      update(patch) { return { eq() { captured.push({ op: 'update', row: patch }); return Promise.resolve({ error: null }); } }; },
    };
    return api;
  }
  return { from };
}

test('generateClimateDrafts: 근접 태풍 1건 → climate draft 1건 적재(원거리 이벤트 무시)', async () => {
  const captured = [];
  const res = await generateClimateDrafts(fakeSupabase({ captured }), GOOD_LLM, { asof: new Date('2026-06-23') });
  assert.equal(captured.length, 1);
  const row = captured[0].row;
  assert.equal(row.module, 'climate');
  assert.equal(row.status, 'draft');
  assert.equal(row.metric_ref, 'climate:r3:hko-2611');
  assert.match(row.statement, /기상 리스크 변화/);
  assert.equal(res.inserted, 1);
});

test('generateClimateDrafts: 근접 이벤트 0건 → 빈 초안 없이 스킵', async () => {
  const captured = [];
  const onlyFar = fakeSupabase({ captured });
  // events를 원거리 1건만 남기도록 교체
  const sb = {
    from(t) {
      if (t === 'events') {
        return { select() { return this; }, order() { return this; }, then(r) { return Promise.resolve({ data: [{ id: 'gdacs:far', kind: 'flood', title: 'Far', severity: 'r', lon: -46.3, lat: -23.9, area: 'Brazil' }] }).then(r); } };
      }
      return onlyFar.from(t);
    },
  };
  const res = await generateClimateDrafts(sb, GOOD_LLM, { asof: new Date('2026-06-23') });
  assert.equal(captured.length, 0);
  assert.equal(res.pairs, 0);
});

test('generateClimateDrafts: 이미 발행된 동일 키는 보존(덮어쓰기 금지)', async () => {
  const captured = [];
  const existing = [{ id: 'pub1', metric_ref: 'climate:r3:hko-2611', model_version: 'climate-v1', status: 'published' }];
  const res = await generateClimateDrafts(fakeSupabase({ captured, forecastsExisting: existing }), GOOD_LLM, { asof: new Date('2026-06-23') });
  assert.equal(captured.length, 0); // insert/update 안 함
  assert.equal(res.skippedExisting, 1);
});

test('generateClimateDrafts: 태풍·홍수 외(storm/tornado)는 노선 근접해도 제외', async () => {
  const captured = [];
  // taiwan 좌표(119.5,24.0)에 정확히 위치한 storm — r3에 0km로 근접하지만 kind=storm → 게이트 제외.
  const events = [{ id: 'nws:tornado', kind: 'storm', title: 'Tornado Warning', severity: 'r', lon: 119.5, lat: 24.0, area: 'x' }];
  const res = await generateClimateDrafts(fakeSupabase({ captured, events }), GOOD_LLM, { asof: new Date('2026-06-23') });
  assert.equal(captured.length, 0);
  assert.equal(res.pairs, 0);
});

test('generateClimateDrafts: dryRun이면 DB 쓰지 않고 행만 반환', async () => {
  const captured = [];
  const res = await generateClimateDrafts(fakeSupabase({ captured }), GOOD_LLM, { asof: new Date('2026-06-23'), dryRun: true });
  assert.equal(captured.length, 0);
  assert.equal(res.drafts.length, 1);
  assert.equal(res.drafts[0].row.metric_ref, 'climate:r3:hko-2611');
});
