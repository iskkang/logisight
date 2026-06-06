'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { scoreForecast } = require('./score');

// 문서 §2 워크드 예제: 부산→LA, A=2 B=1 C=2 D=1 E=2 → composite 1.60
// (규칙 문자대로: 수출 +6%/accelerating은 C 규칙 '≥5% & accelerating'에 해당해 +2.
//  문서 예제 텍스트의 C=1/1.35는 demand=1로 계산한 오기 — 최종 판정은 동일.)
const PUS_LAX = {
  mode: 'ocean', cadence: 'monthly',
  rate_series: { latest: 2850, unit: 'USD/FEU', mom_pct: 6.2, trend_3p: 'up_3', percentile_52w: 78, asof_age_days: 5 },
  supply: { blank_sailing: { source_type: 'tracker_quoted', ratio_pct: 12, direction: 'expanding', signal_age_days: 3 } },
  demand: { export_momentum_yoy_pct: 6, momentum_trend: 'accelerating' },
  cost: { fuel_mom_pct: 9 },
  pricing_actions: { announcements: [{ type: 'GRI', effective: '2026-07-01' }], historical_success_rate: 0.65 },
};

test('scoreForecast: golden case → up / 1.6 / +3~7 / high', () => {
  const r = scoreForecast(PUS_LAX);
  assert.equal(r.abstain, false);
  assert.equal(r.direction, 'up');
  assert.equal(r.composite_score, 1.6);
  assert.equal(r.range_low_pct, 3);
  assert.equal(r.range_high_pct, 7);
  assert.equal(r.expected_range_pct, '+3~7');
  assert.equal(r.confidence, 'high');
  assert.equal(r.model_version, 'v1.4.1');
  assert.equal(r.factor_scores.length, 5);
});

test('scoreForecast: single-reading blank_sailing → 방향 미산출 flag', () => {
  const r = scoreForecast({
    mode: 'ocean', cadence: 'weekly',
    rate_series: { latest: 1000, trend_3p: 'up_2', percentile_52w: 60, asof_age_days: 3 },
    supply: { blank_sailing: { source_type: 'tracker_quoted', ratio_pct: 5.5, direction: 'stable', direction_observed: false, signal_age_days: 2 } },
    demand: { export_momentum_yoy_pct: 3, momentum_trend: 'stable' },
  });
  assert.ok(r.data_quality_flags.some((f) => /방향 미산출/.test(f)));
});

// (b-3) 중국 수급 보정
const b3base = {
  mode: 'ocean', cadence: 'weekly',
  rate_series: { latest: 1000, trend_3p: 'up_2', percentile_52w: 60, asof_age_days: 3 },
  supply: { blank_sailing: { source_type: 'tracker_quoted', ratio_pct: 5.5, direction: 'stable', direction_observed: true, signal_age_days: 2 } },
  demand: { export_momentum_yoy_pct: 3, momentum_trend: 'stable' },
};
const supScore = (r) => r.factor_scores.find((f) => f.factor === 'supply').score;

test('b-3: SCFI 강세 + widening → china_squeeze +1 → supply +0.5', () => {
  const r = scoreForecast({ ...b3base, china_factor: { scfi_mom_pct: 4, scfi_vs_kr_spread: 'widening', china_export_signal: null } });
  assert.equal(supScore(r), 0.5); // 0 + 0.5×1
  assert.ok(r.data_quality_flags.some((f) => /중국 수급 보정/.test(f)));
});
test('b-3: SCFI 약세 + slump → china_squeeze -1 → supply -0.5', () => {
  const r = scoreForecast({ ...b3base, china_factor: { scfi_mom_pct: -4, scfi_vs_kr_spread: 'narrowing', china_export_signal: 'slump' } });
  assert.equal(supScore(r), -0.5);
});
test('b-3: china_factor 결측 → supply 보정 없음', () => {
  const r = scoreForecast({ ...b3base });
  assert.equal(supScore(r), 0);
  assert.equal(r.data_quality_flags.some((f) => /중국 수급 보정/.test(f)), false);
});

test('scoreForecast: missing rate_series → abstain', () => {
  const r = scoreForecast({ mode: 'ocean', cadence: 'weekly', rate_series: null });
  assert.equal(r.abstain, true);
});

test('scoreForecast: future-dated rate (negative age) → abstain', () => {
  const r = scoreForecast({
    mode: 'ocean', cadence: 'weekly',
    rate_series: { latest: 1000, trend_3p: 'up_2', percentile_52w: 60, asof_age_days: -7 },
    supply: { blank_sailing: { source_type: 'tracker_quoted', ratio_pct: 9, direction: 'expanding', signal_age_days: 3 } },
    demand: { export_momentum_yoy_pct: 3, momentum_trend: 'stable' },
  });
  assert.equal(r.abstain, true);
});

test('scoreForecast: stale rate (weekly D-21+) → abstain', () => {
  const r = scoreForecast({
    mode: 'ocean', cadence: 'weekly',
    rate_series: { latest: 1000, trend_3p: 'up_2', asof_age_days: 30 },
    supply: { blank_sailing: { source_type: 'tracker_quoted', ratio_pct: 9, direction: 'expanding', signal_age_days: 3 } },
    demand: { export_momentum_yoy_pct: 3, momentum_trend: 'stable' },
  });
  assert.equal(r.abstain, true);
});

test('scoreForecast: supply & demand both missing → abstain', () => {
  const r = scoreForecast({
    mode: 'ocean', cadence: 'weekly',
    rate_series: { latest: 1000, trend_3p: 'up_2', percentile_52w: 60, asof_age_days: 3 },
    supply: { blank_sailing: { source_type: 'none' } },
    demand: {},
  });
  assert.equal(r.abstain, true);
});

test('scoreForecast: missing factor recorded in data_quality_flags', () => {
  const input = { ...PUS_LAX, pricing_actions: null };
  const r = scoreForecast(input);
  assert.equal(r.abstain, false);
  assert.ok(r.data_quality_flags.some((f) => f.startsWith('pricing')));
  assert.equal(r.factor_scores.find((x) => x.factor === 'pricing').missing, true);
});
