'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { adjudicateDue } = require('./adjudicate');

function fakeSupabase({ forecasts, indices, kita }, captured) {
  function from(table) {
    let rows = table === 'forecasts' ? (forecasts || []).slice()
      : table === 'kita_sea_rates' ? (kita || []).slice()
      : (indices || []).slice();
    const api = {
      select() { return api; },
      eq(col, val) { rows = rows.filter((r) => r[col] === val); return api; },
      is(col, val) { rows = rows.filter((r) => (val === null ? r[col] == null : r[col] === val)); return api; },
      lte(col, val) { rows = rows.filter((r) => String(r[col]) <= String(val)); return api; },
      order() { return api; },
      limit() { return Promise.resolve({ data: rows }); },
      then(res, rej) { return Promise.resolve({ data: rows, error: null }).then(res, rej); },
      update(patch) { return { eq(_c, id) { captured.push({ id, patch }); return Promise.resolve({ error: null }); } }; },
    };
    return api;
  }
  return { from };
}

test('adjudicateDue: resolves a due forecast as hit and writes outcome', async () => {
  const captured = [];
  const forecasts = [{
    id: 'f1', metric_ref: 'KCCI', horizon_date: '2026-07-03', status: 'published', outcome: null,
    direction: 'up', range_low_pct: 3, range_high_pct: 7, metric_value_at_publish: 1000,
  }];
  const indices = [{ index_code: 'KCCI', value: 1050, week_date: '2026-07-03' }]; // +5% → hit
  const res = await adjudicateDue(fakeSupabase({ forecasts, indices }, captured), { asof: new Date('2026-07-10T00:00:00Z') });
  assert.equal(res.resolved, 1);
  assert.equal(captured.length, 1);
  assert.equal(captured[0].patch.outcome, 'hit');
  assert.equal(captured[0].patch.realized_pct, 5);
  assert.equal(captured[0].patch.status, 'resolved');
  assert.equal('outcome_note' in captured[0].patch, false); // 복기는 에디터 몫
});

test('adjudicateDue: actual not yet available → pending, no write', async () => {
  const captured = [];
  const forecasts = [{
    id: 'f2', metric_ref: 'KCCI', horizon_date: '2026-07-03', status: 'published', outcome: null,
    direction: 'up', range_low_pct: 3, range_high_pct: 7, metric_value_at_publish: 1000,
  }];
  const indices = [{ index_code: 'KCCI', value: 1020, week_date: '2026-06-26' }]; // horizon 이전뿐
  const res = await adjudicateDue(fakeSupabase({ forecasts, indices }, captured), { asof: new Date('2026-07-10T00:00:00Z') });
  assert.equal(res.pending, 1);
  assert.equal(captured.length, 0);
});

// E2E: kita 월간 항로 — horizon 월 중순(7/5)에 7월 실측을 골라야 함(월말 정규화). 범위 안 → hit.
test('adjudicateDue: kita lane down → hit, 월경계(7월 실측) 정확', async () => {
  const captured = [];
  const forecasts = [{
    id: 'k1', metric_ref: 'kita_sea_rates:부산-함부르크', horizon_date: '2026-07-05', status: 'published',
    outcome: null, direction: 'down', range_low_pct: -25, range_high_pct: -15, metric_value_at_publish: 2900,
  }];
  const kita = [
    { origin: '부산', dest: '함부르크', feu: 2500, year_mon: '202608' }, // 8월(오판 시 선택될 값)
    { origin: '부산', dest: '함부르크', feu: 2300, year_mon: '202607' }, // 7월 = 정답
    { origin: '부산', dest: '함부르크', feu: 2900, year_mon: '202606' },
  ];
  const res = await adjudicateDue(fakeSupabase({ forecasts, kita }, captured), { asof: new Date('2026-08-01T00:00:00Z') });
  assert.equal(res.resolved, 1);
  assert.equal(captured[0].patch.realized_pct, -20.69); // (2300-2900)/2900 — 7월값. 8월(2500)이면 -13.79
  assert.equal(captured[0].patch.outcome, 'hit'); // -20.69 ∈ [-25,-15]
});

// E2E: 방향만 맞고 범위 밖 → partial.
test('adjudicateDue: up 방향 맞음·범위 밖 → partial', async () => {
  const captured = [];
  const forecasts = [{
    id: 'p1', metric_ref: 'KCCI', horizon_date: '2026-07-03', status: 'published', outcome: null,
    direction: 'up', range_low_pct: 3, range_high_pct: 7, metric_value_at_publish: 1000,
  }];
  const indices = [{ index_code: 'KCCI', value: 1010, week_date: '2026-07-03' }]; // +1% — 양수지만 범위 밖
  const res = await adjudicateDue(fakeSupabase({ forecasts, indices }, captured), { asof: new Date('2026-07-10T00:00:00Z') });
  assert.equal(captured[0].patch.outcome, 'partial');
});

// E2E: 방향 틀림 → miss.
test('adjudicateDue: up 예측인데 하락 실측 → miss', async () => {
  const captured = [];
  const forecasts = [{
    id: 'm1', metric_ref: 'KCCI', horizon_date: '2026-07-03', status: 'published', outcome: null,
    direction: 'up', range_low_pct: 3, range_high_pct: 7, metric_value_at_publish: 1000,
  }];
  const indices = [{ index_code: 'KCCI', value: 980, week_date: '2026-07-03' }]; // -2%
  const res = await adjudicateDue(fakeSupabase({ forecasts, indices }, captured), { asof: new Date('2026-07-10T00:00:00Z') });
  assert.equal(captured[0].patch.outcome, 'miss');
});

// E2E: flat — ±1% 이내 hit, 초과 miss.
test('adjudicateDue: flat ±1% 이내 → hit', async () => {
  const captured = [];
  const forecasts = [{
    id: 'fl1', metric_ref: 'KCCI', horizon_date: '2026-07-03', status: 'published', outcome: null,
    direction: 'flat', range_low_pct: null, range_high_pct: null, metric_value_at_publish: 1000,
  }];
  const indices = [{ index_code: 'KCCI', value: 1005, week_date: '2026-07-03' }]; // +0.5%
  await adjudicateDue(fakeSupabase({ forecasts, indices }, captured), { asof: new Date('2026-07-10T00:00:00Z') });
  assert.equal(captured[0].patch.outcome, 'hit');
});
