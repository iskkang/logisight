'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { WEEKLY_TARGETS, horizonDate, MAJOR_DEST_KEYWORDS } = require('./targets');

test('weekly targets: KCCI/SCFI/WCI present, all ocean/weekly', () => {
  const codes = WEEKLY_TARGETS.map((t) => t.metric_ref);
  assert.ok(codes.includes('KCCI'));
  assert.ok(codes.includes('SCFI'));
  assert.ok(codes.includes('WCI'));
  assert.ok(WEEKLY_TARGETS.every((t) => t.mode === 'ocean' && t.cadence === 'weekly'));
});
test('horizonDate: asof + weeks', () => {
  assert.equal(horizonDate(new Date('2026-06-05T00:00:00Z'), 4), '2026-07-03');
});
test('major dest keywords non-empty', () => {
  assert.ok(MAJOR_DEST_KEYWORDS.length >= 2);
});

// KCCI는 한국발 지수, 월간 KITA 항로는 전부 부산발이다.
// 일본 화주에게 '부산→뉴욕' 전망은 번역 대상이 아니라 아예 대상이 아니다.
test('WEEKLY_TARGETS_JA: 한국발 지수를 넣지 않는다', () => {
  const { WEEKLY_TARGETS_JA, WEEKLY_BY_LANG } = require('./targets');
  assert.ok(!WEEKLY_TARGETS_JA.some((t) => t.metric_ref === 'KCCI'));
  assert.ok(WEEKLY_TARGETS_JA.some((t) => t.metric_ref === 'SCFI'));
  assert.ok(!WEEKLY_TARGETS_JA.some((t) => /[가-힣]/.test(t.label)), '라벨에 한글');
  assert.equal(WEEKLY_BY_LANG.ja, WEEKLY_TARGETS_JA);
});
