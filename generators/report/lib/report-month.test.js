'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { monthEndISO, prevMonthOf, resolveMonth } = require('./report-month');

test('resolveMonth: --month 없으면 현재(발행) 월', () => {
  assert.equal(resolveMonth(['--all'], new Date('2026-07-03T00:00:00Z')), '2026-07');
});

test('resolveMonth: 월 첫날 실행도 현재 월', () => {
  assert.equal(resolveMonth(['--all'], new Date('2026-07-01T00:00:00Z')), '2026-07');
});

test('resolveMonth: --month 오버라이드 우선', () => {
  assert.equal(resolveMonth(['--month=2026-05', 'ocean'], new Date('2026-07-03T00:00:00Z')), '2026-05');
});

test('prevMonthOf: 7월 라벨 → 데이터 6월', () => {
  assert.equal(prevMonthOf('2026-07'), '2026-06');
});

test('prevMonthOf: 1월 라벨 → 전년 12월 롤오버', () => {
  assert.equal(prevMonthOf('2026-01'), '2025-12');
});

test('prevMonthOf: 3월 라벨 → 2월', () => {
  assert.equal(prevMonthOf('2026-03'), '2026-02');
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

test('통합: 7월 라벨 → 데이터 상한 6월 말일', () => {
  const label = resolveMonth(['--all'], new Date('2026-07-05T00:00:00Z'));
  assert.equal(label, '2026-07');                          // 라벨(이름)은 발행 월
  assert.equal(monthEndISO(prevMonthOf(label)), '2026-06-30'); // 데이터 상한은 직전월 말일
});
