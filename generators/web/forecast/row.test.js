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

test('mapVerdictToRow: confident prose → auto-published with published_at', () => {
  const asof = new Date('2026-06-17T00:00:00Z');
  const row = mapVerdictToRow(input, verdict, prose, asof);
  assert.equal(row.module, 'rates');
  assert.equal(row.metric_ref, 'KCCI');
  assert.equal(row.cadence, 'weekly');
  assert.equal(row.horizon_date, '2026-07-03');
  assert.equal(row.direction, 'up');
  assert.equal(row.composite_score, 1.6);
  assert.equal(row.range_low_pct, 3);
  assert.equal(row.model_version, 'v1.4.1');
  assert.equal(row.metric_value_at_publish, 1200);
  assert.equal(row.status, 'published'); // 확신 전망 = 자동 발행
  assert.equal(row.published_at, '2026-06-17T00:00:00.000Z');
  assert.equal(row.statement, '상승 가능성');
  assert.equal(Array.isArray(row.basis), true);
});
test('mapVerdictToRow: needs_editor prose → placeholder statement, draft(큐 유지)', () => {
  const row = mapVerdictToRow(input, verdict, { statement: null, impact_note: null, needs_editor: true });
  assert.equal(row.status, 'draft'); // 본문 미작성 → 검수 큐에 남김(자동 발행 제외)
  assert.equal(row.published_at, null);
  assert.match(row.statement, /검수/); // 에디터 작성 안내 placeholder
  assert.equal(row.impact_note, null);
});

// basis는 근거 목록으로 화면에 그대로 나온다. 산문만 옮기면 '결항률'이 남는다.
test('mapVerdictToRow(ja): lang과 basis 라벨이 일본어', () => {
  const { mapVerdictToRow } = require('./row');
  const inp = {
    metric_ref: 'SCFI', cadence: 'weekly', horizon_date: '2026-09-01',
    rate_series: { latest: 2300, mom_pct: 4 },
    supply: { blank_sailing: { ratio_pct: 5.5, direction: 'flat' } },
    demand: { export_momentum_yoy_pct: 3 },
  };
  const v = { direction: 'up', strength: '上昇', model_version: 'v1' };
  const row = mapVerdictToRow(inp, v, { statement: '本文', impact_note: '注記', needs_editor: false }, new Date('2026-08-05'), 'ja');
  assert.equal(row.lang, 'ja');
  assert.ok(row.basis.some((b) => b.includes('欠航率')));
  assert.ok(!row.basis.some((b) => /[가-힣]/.test(b)), `basis에 한글: ${row.basis}`);
});

test('mapVerdictToRow: lang 기본값은 ko', () => {
  const { mapVerdictToRow } = require('./row');
  const row = mapVerdictToRow({ metric_ref: 'KCCI' }, { direction: 'up', model_version: 'v1' }, { needs_editor: true }, new Date(), undefined);
  assert.equal(row.lang, 'ko');
});
