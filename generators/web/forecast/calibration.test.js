'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  directionAccuracy, biasAndMae, rangeCoverage, factorSignAlignment, aggregateByMetric,
} = require('./calibration');

// ─── directionAccuracy ───

test('directionAccuracy: hit=1, partial=0.5, miss=0 → 0.375', () => {
  const rows = [{ outcome: 'hit' }, { outcome: 'partial' }, { outcome: 'miss' }, { outcome: 'miss' }];
  // (1 + 0.5 + 0 + 0) / 4 = 0.375
  assert.equal(directionAccuracy(rows), 0.375);
});

test('directionAccuracy: 모두 hit → 1', () => {
  assert.equal(directionAccuracy([{ outcome: 'hit' }, { outcome: 'hit' }]), 1);
});

test('directionAccuracy: 모두 miss → 0', () => {
  assert.equal(directionAccuracy([{ outcome: 'miss' }]), 0);
});

test('directionAccuracy: empty → null', () => {
  assert.equal(directionAccuracy([]), null);
});

// ─── biasAndMae ───

test('biasAndMae: midpoint=5, realized=5 → bias=0, mae=0', () => {
  const rows = [{ range_low_pct: 3, range_high_pct: 7, realized_pct: 5 }];
  const { bias, mae, n } = biasAndMae(rows);
  assert.equal(bias, 0);
  assert.equal(mae, 0);
  assert.equal(n, 1);
});

test('biasAndMae: 두 행 평균편차', () => {
  // midpoint=5. realized=8 → diff=+3. realized=3 → diff=-2. bias=(3-2)/2=0.5, mae=(3+2)/2=2.5
  const rows = [
    { range_low_pct: 3, range_high_pct: 7, realized_pct: 8 },
    { range_low_pct: 3, range_high_pct: 7, realized_pct: 3 },
  ];
  const { bias, mae } = biasAndMae(rows);
  assert.equal(bias, 0.5);
  assert.equal(mae, 2.5);
});

test('biasAndMae: range 없는 행 제외', () => {
  const rows = [
    { range_low_pct: null, range_high_pct: null, realized_pct: 5 },
    { range_low_pct: 3, range_high_pct: 7, realized_pct: 5 },
  ];
  const { n } = biasAndMae(rows);
  assert.equal(n, 1);
});

test('biasAndMae: 전부 range 없음 → n=0, bias/mae=null', () => {
  const { bias, mae, n } = biasAndMae([{ range_low_pct: null, range_high_pct: null, realized_pct: 5 }]);
  assert.equal(n, 0);
  assert.equal(bias, null);
  assert.equal(mae, null);
});

// ─── rangeCoverage ───

test('rangeCoverage: 2/3 커버 (경계값 포함)', () => {
  const rows = [
    { range_low_pct: 3, range_high_pct: 7, realized_pct: 5 },  // in
    { range_low_pct: 3, range_high_pct: 7, realized_pct: 8 },  // out
    { range_low_pct: 3, range_high_pct: 7, realized_pct: 3 },  // in (boundary)
  ];
  assert.equal(rangeCoverage(rows), Math.round((2 / 3) * 1000) / 1000);
});

test('rangeCoverage: 전부 커버 → 1', () => {
  const rows = [{ range_low_pct: 3, range_high_pct: 7, realized_pct: 5 }];
  assert.equal(rangeCoverage(rows), 1);
});

test('rangeCoverage: range 없는 행만 → null', () => {
  assert.equal(rangeCoverage([{ range_low_pct: null, range_high_pct: null, realized_pct: 5 }]), null);
});

// ─── factorSignAlignment ───

test('factorSignAlignment: 상승 실측 + 양의 팩터들 → 1.0', () => {
  const rows = [{
    realized_pct: 5,
    factor_scores: [
      { factor: 'momentum', score: 1, weight: 0.35, missing: false },
      { factor: 'supply', score: 1, weight: 0.25, missing: false },
      { factor: 'demand', score: null, weight: 0.2, missing: true },
    ],
  }];
  assert.equal(factorSignAlignment(rows), 1);
});

test('factorSignAlignment: 1개 불일치 → 0.5', () => {
  const rows = [{
    realized_pct: 5,
    factor_scores: [
      { factor: 'momentum', score: 1, weight: 0.35, missing: false },  // +1 vs +5 → match
      { factor: 'supply', score: -1, weight: 0.25, missing: false },   // -1 vs +5 → mismatch
    ],
  }];
  assert.equal(factorSignAlignment(rows), 0.5);
});

test('factorSignAlignment: factor_scores 없으면 null', () => {
  assert.equal(factorSignAlignment([{ realized_pct: 5, factor_scores: null }]), null);
});

test('factorSignAlignment: realized_pct 없는 행 무시', () => {
  const rows = [
    { realized_pct: null, factor_scores: [{ factor: 'momentum', score: 1, weight: 0.35, missing: false }] },
    { realized_pct: 5, factor_scores: [{ factor: 'momentum', score: 1, weight: 0.35, missing: false }] },
  ];
  // 두 번째 행만 유효. match=1/1
  assert.equal(factorSignAlignment(rows), 1);
});

// ─── aggregateByMetric ───

test('aggregateByMetric: metric_ref별 독립 집계', () => {
  const rows = [
    {
      metric_ref: 'KCCI', outcome: 'hit',
      range_low_pct: 3, range_high_pct: 7, realized_pct: 5,
      factor_scores: [{ factor: 'momentum', score: 1, weight: 0.35, missing: false }],
    },
    {
      metric_ref: 'KCCI', outcome: 'miss',
      range_low_pct: 3, range_high_pct: 7, realized_pct: -2,
      factor_scores: [{ factor: 'momentum', score: 1, weight: 0.35, missing: false }],
    },
    {
      metric_ref: 'SCFI', outcome: 'partial',
      range_low_pct: 2, range_high_pct: 6, realized_pct: 8,
      factor_scores: [{ factor: 'momentum', score: 1, weight: 0.35, missing: false }],
    },
  ];
  const stats = aggregateByMetric(rows);
  assert.equal(stats.KCCI.n, 2);
  assert.equal(stats.SCFI.n, 1);
  // KCCI 방향 적중률: (1 + 0) / 2 = 0.5
  assert.equal(stats.KCCI.directionAccuracy, 0.5);
  // SCFI 방향 적중률: partial만 → 0.5
  assert.equal(stats.SCFI.directionAccuracy, 0.5);
});

test('aggregateByMetric: metric_ref null → unknown 버킷', () => {
  const rows = [{ metric_ref: null, outcome: 'hit', range_low_pct: null, range_high_pct: null, realized_pct: 5, factor_scores: [] }];
  const stats = aggregateByMetric(rows);
  assert.ok('unknown' in stats);
  assert.equal(stats.unknown.n, 1);
});
