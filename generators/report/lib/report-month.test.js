'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { prevCompletedMonth, monthEndISO, resolveMonth } = require('./report-month');

test('prevCompletedMonth: 7월 초 실행 → 직전 6월', () => {
  assert.equal(prevCompletedMonth(new Date('2026-07-03T00:00:00Z')), '2026-06');
});

test('prevCompletedMonth: 1월 실행 → 전년 12월로 롤오버', () => {
  assert.equal(prevCompletedMonth(new Date('2026-01-15T00:00:00Z')), '2025-12');
});

test('prevCompletedMonth: 월 첫날 실행도 직전월', () => {
  assert.equal(prevCompletedMonth(new Date('2026-07-01T00:00:00Z')), '2026-06');
});

test('monthEndISO: 6월 → 06-30', () => {
  assert.equal(monthEndISO('2026-06'), '2026-06-30');
});

test('monthEndISO: 2월(윤년 아님) → 02-28', () => {
  assert.equal(monthEndISO('2026-02'), '2026-02-28');
});

test('monthEndISO: 12월 → 12-31', () => {
  assert.equal(monthEndISO('2025-12'), '2025-12-31');
});

test('resolveMonth: --month 오버라이드 우선', () => {
  assert.equal(resolveMonth(['--month=2026-05', 'ocean'], new Date('2026-07-03T00:00:00Z')), '2026-05');
});

test('resolveMonth: --month 없으면 직전 완료월', () => {
  assert.equal(resolveMonth(['--all'], new Date('2026-07-03T00:00:00Z')), '2026-06');
});
