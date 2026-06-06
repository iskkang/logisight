'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildNarratePrompt, validateProse, narrate } = require('./narrate');

const verdict = {
  direction: 'up', strength: '상승 가능성 높음', composite_score: 1.6,
  expected_range_pct: '+3~7', confidence: 'high',
  factor_scores: [{ factor: 'supply', score: 1 }], data_quality_flags: [],
};
const input = {
  metric_ref: 'KCCI', label: 'KCCI 종합', cadence: 'weekly', horizon_date: '2026-07-03',
  rate_series: { latest: 1200, mom_pct: 4.0 },
  supply: { blank_sailing: { ratio_pct: 12, direction: 'expanding' } },
  cost: { fuel_mom_pct: 9 }, demand: { export_momentum_yoy_pct: 6 },
};

test('buildNarratePrompt: system enforces constraints, user carries facts', () => {
  const { system, user } = buildNarratePrompt(input, verdict);
  assert.match(system, /확률|가능성/);
  assert.match(system, /때문에/); // 금지어로 명시
  assert.match(system, /현상.*원인.*배경.*전망/s);
  assert.match(user, /KCCI/);
  assert.match(user, /up|상승/);
  assert.match(user, /\+3~7/);
});

test('buildNarratePrompt: includes recent news as qualitative context', () => {
  const { user } = buildNarratePrompt(input, verdict, [
    { title: '홍해 우회 지속', summary: '수에즈 회피로 항행거리 증가' },
  ]);
  assert.match(user, /최근 관련 해운 뉴스/);
  assert.match(user, /홍해 우회 지속/);
});

test('validateProse: good prose passes', () => {
  const r = validateProse({
    statement: '한국발 해상운임은 향후 2~4주 추가 상승 가능성이 높은 것으로 추정된다.',
    impact_note: 'FEU당 비용 상승 압력 → 7월 부킹 앞당겨 검토.',
    direction_echo: 'up',
  }, verdict);
  assert.equal(r.ok, true);
});
test('validateProse: direction mismatch fails', () => {
  const r = validateProse({ statement: '상승 가능성', impact_note: 'x', direction_echo: 'down' }, verdict);
  assert.equal(r.ok, false);
});
test('validateProse: causal-certainty phrase fails', () => {
  const r = validateProse({ statement: '결항 때문에 오른다', impact_note: 'x', direction_echo: 'up' }, verdict);
  assert.equal(r.ok, false);
});
test('validateProse: no hedge marker fails', () => {
  const r = validateProse({ statement: '운임이 오른다', impact_note: 'x', direction_echo: 'up' }, verdict);
  assert.equal(r.ok, false);
});
test('validateProse: empty statement fails', () => {
  const r = validateProse({ statement: '', impact_note: 'x', direction_echo: 'up' }, verdict);
  assert.equal(r.ok, false);
});

test('narrate: returns prose when LLM output validates', async () => {
  const fake = async () => JSON.stringify({
    statement: '상승 가능성이 높은 것으로 추정된다.', impact_note: 'FEU 비용 상승 → 부킹 검토.', direction_echo: 'up',
  });
  const r = await narrate(fake, input, verdict);
  assert.equal(r.needs_editor, false);
  assert.match(r.statement, /추정/);
});
test('narrate: regenerates once then falls back to editor on persistent mismatch', async () => {
  let calls = 0;
  const fake = async () => { calls++; return JSON.stringify({ statement: '내린다', impact_note: 'x', direction_echo: 'down' }); };
  const r = await narrate(fake, input, verdict);
  assert.equal(calls, 2); // 최초 + 재시도 1회
  assert.equal(r.needs_editor, true);
  assert.equal(r.statement, null);
});
test('narrate: unparseable LLM output → editor fallback', async () => {
  const fake = async () => 'not json at all';
  const r = await narrate(fake, input, verdict);
  assert.equal(r.needs_editor, true);
});
