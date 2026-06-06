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
