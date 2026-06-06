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
test('Mar → none', () => {
  assert.equal(seasonalityFlag(d('2026-03-15')), 'none');
});
