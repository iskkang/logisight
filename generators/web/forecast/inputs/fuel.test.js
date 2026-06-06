'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildFuel } = require('./fuel');

const asof = new Date('2026-06-05T00:00:00Z');

test('mom from latest vs ~30d prior', () => {
  const rows = [
    { obs_date: '2026-06-04', price_usd: 600 },
    { obs_date: '2026-05-06', price_usd: 550 }, // ~29d prior
    { obs_date: '2026-04-01', price_usd: 500 },
  ];
  const f = buildFuel(rows, asof);
  assert.equal(Math.round(f.fuel_mom_pct), 9); // (600-550)/550 ≈ 9.09
  assert.equal(f.fuel_obs_lag_weeks <= 1, true);
});
test('insufficient history → null', () => {
  assert.equal(buildFuel([{ obs_date: '2026-06-04', price_usd: 600 }], asof), null);
});
test('empty → null', () => {
  assert.equal(buildFuel([], asof), null);
});
test('zero prior price → null (no Infinity into scorer)', () => {
  const rows = [{ obs_date: '2026-06-04', price_usd: 600 }, { obs_date: '2026-05-01', price_usd: 0 }];
  assert.equal(buildFuel(rows, asof), null);
});
