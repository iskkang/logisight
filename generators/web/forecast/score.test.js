'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  scoreMomentum, scoreSupply, scoreDemand, scoreCost, scorePricing,
} = require('./score');

test('momentum: up_3 + high percentile → +2', () => {
  assert.equal(scoreMomentum({ trend_3p: 'up_3', percentile_52w: 78, mom_pct: 6.2 }), 2);
});
test('momentum: extreme percentile applies mean-reversion (-0.5)', () => {
  assert.equal(scoreMomentum({ trend_3p: 'up_3', percentile_52w: 92, mom_pct: 6 }), 1.5);
});
test('momentum: missing trend → null', () => {
  assert.equal(scoreMomentum({ percentile_52w: 50 }), null);
});

test('supply: tracker_quoted ratio>=15 expanding → +2', () => {
  assert.equal(scoreSupply({ source_type: 'tracker_quoted', ratio_pct: 16, direction: 'expanding', signal_age_days: 3 }), 2);
});
test('supply: tracker_quoted ratio 12 → +1', () => {
  assert.equal(scoreSupply({ source_type: 'tracker_quoted', ratio_pct: 12, direction: 'expanding', signal_age_days: 3 }), 1);
});
test('supply: stale signal (>14d) → null', () => {
  assert.equal(scoreSupply({ source_type: 'tracker_quoted', ratio_pct: 16, direction: 'expanding', signal_age_days: 20 }), null);
});
test('supply: news_derived easing major 2 sources → -2', () => {
  assert.equal(scoreSupply({ source_type: 'news_derived', direction: 'easing', magnitude_class: 'major', independent_sources: 2, signal_age_days: 5 }), -2);
});
test('supply: none → null', () => {
  assert.equal(scoreSupply({ source_type: 'none' }), null);
});

test('demand: +6 accelerating → +2', () => {
  assert.equal(scoreDemand({ export_momentum_yoy_pct: 6, momentum_trend: 'accelerating' }), 2);
});
test('demand: flat (|m|<=2) → 0', () => {
  assert.equal(scoreDemand({ export_momentum_yoy_pct: 1, momentum_trend: 'stable' }), 0);
});
test('demand: missing → null', () => {
  assert.equal(scoreDemand({}), null);
});

test('cost: fuel +9 → +1', () => {
  assert.equal(scoreCost({ fuel_mom_pct: 9 }, 1), 1);
});
test('cost: pass-through failure halves score when demand<=-1', () => {
  assert.equal(scoreCost({ fuel_mom_pct: 9 }, -1), 0.5);
});
test('cost: missing → null', () => {
  assert.equal(scoreCost({}, 0), null);
});

test('pricing: GRI announced + success>=0.6 → +2', () => {
  assert.equal(scorePricing({ announcements: [{ type: 'GRI', effective: '2026-07-01' }], historical_success_rate: 0.65 }), 2);
});
test('pricing: announced, success unknown → +1', () => {
  assert.equal(scorePricing({ announcements: [{ type: 'PSS' }], historical_success_rate: null }), 1);
});
test('pricing: no announcements → 0 (defined state, not missing)', () => {
  assert.equal(scorePricing({ announcements: [] }), 0);
});
test('pricing: not gathered → null', () => {
  assert.equal(scorePricing(null), null);
});
