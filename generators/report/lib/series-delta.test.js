'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { prevAtOrBefore } = require('./series-delta');

// 실제 SCFI_USWC 시리즈 모양(갭 포함): 05-25 미적재
const S = [
  { week: '2026-06-22', v: 6067 },
  { week: '2026-06-15', v: 5683 },
  { week: '2026-06-08', v: 5101 },
  { week: '2026-06-01', v: 4552 },
  { week: '2026-05-18', v: 3154 },
  { week: '2026-05-04', v: 2826 },
];

test('갭 있는 시리즈: −28일(05-25) 이전 최근접 = 05-18 (3주 전 06-01 아님)', () => {
  const p = prevAtOrBefore(S, '2026-06-22', 28);
  assert.equal(p.week, '2026-05-18');
  assert.equal(p.v, 3154);
});

test('갭 없는 시리즈: 정확히 4주 전 선택', () => {
  const W = [
    { week: '2026-06-29', v: 100 },
    { week: '2026-06-22', v: 90 },
    { week: '2026-06-15', v: 80 },
    { week: '2026-06-08', v: 70 },
    { week: '2026-06-01', v: 60 },
  ];
  assert.equal(prevAtOrBefore(W, '2026-06-29', 28).week, '2026-06-01');
});

test('전주(WoW) = 7일 기준: 직전 공표주', () => {
  assert.equal(prevAtOrBefore(S, '2026-06-22', 7).week, '2026-06-15');
});

test('기준일 이전 행이 없으면 null (과대비교 방지)', () => {
  assert.equal(prevAtOrBefore(S.slice(0, 2), '2026-06-22', 28), null);
});

test('week 필드명이 week_date여도 동작', () => {
  const D = [
    { week_date: '2026-06-22', value: 10 },
    { week_date: '2026-05-18', value: 5 },
  ];
  const p = prevAtOrBefore(D, '2026-06-22', 28);
  assert.equal(p.week_date, '2026-05-18');
});
