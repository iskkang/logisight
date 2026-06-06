'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { seasonalityFlag } = require('./calendar');

const d = (iso) => new Date(`${iso}T00:00:00Z`);

test('Jun/Jul → peak_approaching (ahead of Aug–Oct US peak)', () => {
  assert.equal(seasonalityFlag(d('2026-06-15')), 'peak_approaching');
  assert.equal(seasonalityFlag(d('2026-07-01')), 'peak_approaching');
});
test('Aug–Oct → peak', () => {
  assert.equal(seasonalityFlag(d('2026-09-10')), 'peak');
});
test('Dec → peak_approaching (pre-CNY frontloading)', () => {
  assert.equal(seasonalityFlag(d('2026-12-20')), 'peak_approaching');
});
test('Nov → off (post-peak wind-down, v1.3 enum)', () => {
  assert.equal(seasonalityFlag(d('2026-11-15')), 'off');
});
test('region-aware: 미주 vs EU differ in July', () => {
  // 미주 성수기 선적 7~10월 → July=peak; EU는 가을 성수기라 July=선행
  assert.equal(seasonalityFlag(d('2026-07-15'), '미주'), 'peak');
  assert.equal(seasonalityFlag(d('2026-07-15'), 'EU'), 'peak_approaching');
});
test('region-aware: 미주 June=peak_approaching, Dec=off', () => {
  assert.equal(seasonalityFlag(d('2026-06-06'), '미주'), 'peak_approaching');
  assert.equal(seasonalityFlag(d('2026-12-10'), '미주'), 'off');
});
test('Mar → none', () => {
  assert.equal(seasonalityFlag(d('2026-03-15')), 'none');
});
