'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { trend3p, percentile, buildRateSeries } = require('./rate-series');

test('trend3p: 3 consecutive positive change_pct → up_3', () => {
  assert.equal(trend3p([{ change_pct: 2 }, { change_pct: 1 }, { change_pct: 3 }]), 'up_3');
});
test('trend3p: 2 of 3 positive → up_2', () => {
  assert.equal(trend3p([{ change_pct: 2 }, { change_pct: -1 }, { change_pct: 3 }]), 'up_2');
});
test('trend3p: all negative → down_3', () => {
  assert.equal(trend3p([{ change_pct: -2 }, { change_pct: -1 }, { change_pct: -3 }]), 'down_3');
});
test('trend3p: fewer than 3 points → mixed', () => {
  assert.equal(trend3p([{ change_pct: 2 }]), 'mixed');
});

test('percentile: latest is max → 100', () => {
  assert.equal(percentile(100, [10, 50, 100]), 100);
});
test('percentile: latest mid → ~67', () => {
  assert.equal(percentile(50, [10, 50, 100]), 67);
});

test('buildRateSeries: assembles from desc points', () => {
  const points = [
    { value: 2850, change_pct: 6.2, date: '2026-05' },
    { value: 2684, change_pct: 3.0, date: '2026-04' },
    { value: 2606, change_pct: 1.5, date: '2026-03' },
  ];
  const rs = buildRateSeries(points, { unit: 'USD/FEU', asof: new Date('2026-06-05T00:00:00Z') });
  assert.equal(rs.latest, 2850);
  assert.equal(rs.unit, 'USD/FEU');
  assert.equal(rs.mom_pct, 6.2);
  assert.equal(rs.trend_3p, 'up_3');
  assert.equal(rs.percentile_52w, 100);
  assert.equal(rs.vs_normal_band, 'above');
  assert.equal(rs.asof_age_days >= 0, true);
});
test('buildRateSeries: empty → null', () => {
  assert.equal(buildRateSeries([], { unit: 'x', asof: new Date() }), null);
});
