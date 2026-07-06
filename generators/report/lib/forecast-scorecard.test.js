'use strict';
const test   = require('node:test');
const assert = require('node:assert/strict');
const { judgeClaims, buildScorecardBlock } = require('./forecast-scorecard');

test('hit: 방향 일치(up) → verdict hit, actual ▲+표기', () => {
  const claims = [{ section: 'ocean', claim: 'SCFI 상승 전망', metric: 'SCFI', direction: 'up', horizon: 'M+1' }];
  const series = { SCFI: [{ week: '2026-06-29', v: 2200 }, { week: '2026-06-01', v: 2000 }] };
  const [j] = judgeClaims(claims, series);
  assert.equal(j.verdict, 'hit');
  assert.equal(j.actual, '▲+10.0%');
});

test('miss: 방향 불일치(전망 up, 실측 down) → verdict miss', () => {
  const claims = [{ section: 'ocean', claim: 'SCFI 상승 전망', metric: 'SCFI', direction: 'up', horizon: 'M+1' }];
  const series = { SCFI: [{ week: '2026-06-29', v: 1800 }, { week: '2026-06-01', v: 2000 }] };
  const [j] = judgeClaims(claims, series);
  assert.equal(j.verdict, 'miss');
  assert.equal(j.actual, '▼-10.0%');
});

test('flat 밴드: ±1% 이내 변동은 flat, 전망 flat과 일치하면 hit', () => {
  const claims = [{ section: 'ocean', claim: 'BDI 보합 전망', metric: 'BDI', direction: 'flat', horizon: 'M+1' }];
  const series = { BDI: [{ week: '2026-06-29', v: 1005 }, { week: '2026-06-01', v: 1000 }] };
  const [j] = judgeClaims(claims, series);
  assert.equal(j.verdict, 'hit');
  assert.match(j.actual, /^보합/);
});

test('qualitative: metric null → verdict qualitative, actual —', () => {
  const claims = [{ section: 'macro', claim: '호르무즈 긴장 고조', metric: null, direction: 'up', horizon: 'M+1' }];
  const [j] = judgeClaims(claims, {});
  assert.equal(j.verdict, 'qualitative');
  assert.equal(j.actual, '—');
});

test('qualitative: direction null(방향 없는 주장)은 metric 있어도 판정 불가 — miss 오판 금지', () => {
  const claims = [{ section: 'ocean', claim: 'BDI 조정을 일시적으로 보지 말 것', metric: 'BDI', direction: null, horizon: 'M+1' }];
  const series = { BDI: [{ week: '2026-06-22', v: 2644 }, { week: '2026-05-25', v: 3225 }] };
  const [j] = judgeClaims(claims, series);
  assert.equal(j.verdict, 'qualitative');
});

test('qualitative: metric 있지만 시리즈 부족(1건 이하) → qualitative', () => {
  const claims = [{ section: 'ocean', claim: 'KCCI 상승', metric: 'KCCI', direction: 'up', horizon: 'M+1' }];
  const series = { KCCI: [{ week: '2026-06-29', v: 2200 }] };
  const [j] = judgeClaims(claims, series);
  assert.equal(j.verdict, 'qualitative');
  assert.equal(j.actual, '—');
});

test('qualitative: 해당 metric 시리즈 자체가 없음(indexSeriesByMetric에 키 없음)', () => {
  const claims = [{ section: 'ocean', claim: 'WCI 상승', metric: 'WCI', direction: 'up', horizon: 'M+1' }];
  const [j] = judgeClaims(claims, { SCFI: [{ week: '2026-06-29', v: 100 }, { week: '2026-06-01', v: 90 }] });
  assert.equal(j.verdict, 'qualitative');
  assert.equal(j.actual, '—');
});

test('buildScorecardBlock: judged 비면 null', () => {
  assert.equal(buildScorecardBlock([], '2026-06'), null);
  assert.equal(buildScorecardBlock(null, '2026-06'), null);
});

test('buildScorecardBlock: 표 헤더에 전월 표기, 판정 마크, factText에 소제목 지시', () => {
  const judged = [
    { section: 'ocean', claim: 'SCFI 상승 전망', metric: 'SCFI', direction: 'up', horizon: 'M+1', verdict: 'hit', actual: '▲+10.0%' },
    { section: 'macro', claim: '호르무즈 긴장 고조', metric: null, direction: 'up', horizon: 'M+1', verdict: 'qualitative', actual: '—' },
  ];
  const { table, factText } = buildScorecardBlock(judged, '2026-06');
  assert.match(table, /\| 전월\(2026-06\) 전망 \| 실측 \| 판정 \|/);
  assert.match(table, /✓ 적중/);
  assert.match(table, /—\(정성\)/);
  assert.match(factText, /지난달\(2026-06\) 전망 점검/);
  assert.match(factText, /변명 금지/);
});

test('buildScorecardBlock: claim 40자 초과 시 절단 + 말줄임표', () => {
  const longClaim = '가'.repeat(50);
  const judged = [{ section: 'ocean', claim: longClaim, metric: 'SCFI', direction: 'up', verdict: 'hit', actual: '▲+1.0%' }];
  const { table } = buildScorecardBlock(judged, '2026-06');
  assert.ok(table.includes('가'.repeat(40) + '…'));
  assert.ok(!table.includes('가'.repeat(41)));
});
