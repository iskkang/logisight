'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { regionOf, buildRegionDemand } = require('./demand-region');

test('regionOf: dest/code keywords → region', () => {
  assert.equal(regionOf({ dest: '함부르크' }), 'EU');
  assert.equal(regionOf({ dest: '로스앤젤레스' }), '미주');
  assert.equal(regionOf({ metric_ref: 'WCI_SHA_LAX' }), '미주');
  assert.equal(regionOf({ metric_ref: 'WCI_SHA_RTM' }), 'EU');
  assert.equal(regionOf({ metric_ref: 'KCCI_SEA' }), '동남아');
  assert.equal(regionOf({ metric_ref: 'KCCI' }), null); // 종합 → 불명
});

test('buildRegionDemand: YoY from provisional region totals (full-month)', () => {
  const rows = [
    { period: '2026-05', priod_dt: '01~31', country_code: 'US', export_usd: 110 },
    { period: '2025-05', priod_dt: '01~31', country_code: 'US', export_usd: 100 },
  ];
  const d = buildRegionDemand(rows, '미주', new Date('2026-06-06T00:00:00Z'));
  assert.equal(d.export_momentum_yoy_pct, 10);
});

test('buildRegionDemand: 동남아 sums multiple countries', () => {
  const rows = [
    { period: '2026-05', priod_dt: '01~31', country_code: 'VN', export_usd: 60 },
    { period: '2026-05', priod_dt: '01~31', country_code: 'SG', export_usd: 40 },
    { period: '2025-05', priod_dt: '01~31', country_code: 'VN', export_usd: 50 },
    { period: '2025-05', priod_dt: '01~31', country_code: 'SG', export_usd: 50 },
  ];
  // 2026 = 100 vs 2025 = 100 → 0%
  assert.equal(buildRegionDemand(rows, '동남아', new Date()).export_momentum_yoy_pct, 0);
});

test('buildRegionDemand: region with no countries (CIS/중동) → null', () => {
  assert.equal(buildRegionDemand([], 'CIS', new Date()).export_momentum_yoy_pct, null);
  assert.equal(buildRegionDemand([], '중동', new Date()).export_momentum_yoy_pct, null);
});

test('buildRegionDemand: no prior-year match → yoy null', () => {
  const rows = [{ period: '2026-05', priod_dt: '01~31', country_code: 'US', export_usd: 110 }];
  assert.equal(buildRegionDemand(rows, '미주', new Date()).export_momentum_yoy_pct, null);
});
