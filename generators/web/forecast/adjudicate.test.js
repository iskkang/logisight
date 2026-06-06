'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { adjudicateDue } = require('./adjudicate');

function fakeSupabase({ forecasts, indices }, captured) {
  function from(table) {
    let rows = table === 'forecasts' ? forecasts.slice() : (indices || []).slice();
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
