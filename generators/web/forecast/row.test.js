'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { mapVerdictToRow, buildBasis } = require('./row');

const input = {
  metric_ref: 'KCCI', cadence: 'weekly', horizon_date: '2026-07-03',
  rate_series: { latest: 1200, mom_pct: 4.0 },
  supply: { blank_sailing: { ratio_pct: 12, direction: 'expanding' } },
  cost: { fuel_mom_pct: 9 }, demand: { export_momentum_yoy_pct: 6 },
};
const verdict = {
  direction: 'up', strength: '상승 가능성 높음', composite_score: 1.6,
  range_low_pct: 3, range_high_pct: 7, expected_range_pct: '+3~7', confidence: 'high',
  factor_scores: [{ factor: 'supply', score: 1, weight: 0.3, missing: false }],
  data_quality_flags: [], model_version: 'v1.4.1',
};
const prose = { statement: '상승 가능성', impact_note: 'FEU 비용 상승', needs_editor: false };

test('buildBasis: includes key numbers as strings', () => {
  const b = buildBasis(input);
  assert.ok(Array.isArray(b));
  assert.ok(b.some((s) => s.includes('1200')));
  assert.ok(b.some((s) => s.includes('12')));
});

test('mapVerdictToRow: maps verdict+prose+input → forecasts row', () => {
  const row = mapVerdictToRow(input, verdict, prose);
  assert.equal(row.module, 'rates');
  assert.equal(row.metric_ref, 'KCCI');
  assert.equal(row.cadence, 'weekly');
  assert.equal(row.horizon_date, '2026-07-03');
  assert.equal(row.direction, 'up');
  assert.equal(row.composite_score, 1.6);
  assert.equal(row.range_low_pct, 3);
  assert.equal(row.model_version, 'v1.4.1');
  assert.equal(row.metric_value_at_publish, 1200);
  assert.equal(row.status, 'draft');
  assert.equal(row.statement, '상승 가능성');
  assert.equal(Array.isArray(row.basis), true);
});
test('mapVerdictToRow: needs_editor prose → placeholder statement, draft', () => {
  const row = mapVerdictToRow(input, verdict, { statement: null, impact_note: null, needs_editor: true });
  assert.equal(row.status, 'draft');
  assert.match(row.statement, /검수/); // 에디터 작성 안내 placeholder
  assert.equal(row.impact_note, null);
});
