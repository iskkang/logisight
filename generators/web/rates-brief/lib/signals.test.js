'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { computeOceanPressure, computeGlobalMomentum, computeAir, computeBunker } = require('./signals');

test('ocean pressure: caution at 75th pct with rising 3w avg', () => {
  const dates = ['2026-04-27', '2026-05-04', '2026-05-11', '2026-05-18', '2026-05-25', '2026-06-01', '2026-06-08', '2026-06-15'];
  const kcci = [2000, 2100, 2200, 2300, 2478, 2675, 3042, 3349].map((v, i) => ({ week_date: dates[i], value: v }));
  const s = computeOceanPressure(kcci);
  assert.equal(s.state, 'caution');
  assert.equal(s.pct, 75);
  assert.equal(s.avgLast, 3022);
  assert.equal(Math.round(s.wow * 10) / 10, 29.9);
  assert.match(s.basis, /백분위 75%/);
});

test('global momentum: SCFI +9.5% / WCI +3.4% aligned -> caution', () => {
  const dates = ['2026-05-04', '2026-05-11', '2026-05-18', '2026-06-01', '2026-06-08'];
  const scfi = [2400, 2500, 2571, 2726, 2985.22].map((v, i) => ({ week_date: dates[i], value: v }));
  const wci = [3200, 3300, 3400, 3433, 3549].map((v, i) => ({ week_date: dates[i], value: v }));
  const s = computeGlobalMomentum(scfi, wci);
  assert.equal(Math.round(s.scfiMoM * 10) / 10, 9.5);
  assert.equal(Math.round(s.wciMoM * 10) / 10, 3.4);
  assert.equal(s.aligned, true);
  assert.equal(s.state, 'caution');
});

test('air: drops |MoM|>200 and reports the largest real move', () => {
  const s = computeAir(127.0, '인천→첸나이', 75);
  assert.equal(s.state, 'caution');
  assert.match(s.basis, /\+127\.0%/);
  assert.equal(computeAir(3718, '인천→x', 75), null);
});

test('bunker: VLSFO MoM', () => {
  assert.equal(computeBunker(-5.0).state, 'observe');
  assert.equal(computeBunker(null), null);
});
