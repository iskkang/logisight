'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { WEEKLY_TARGETS, horizonDate, MAJOR_DEST_KEYWORDS } = require('./targets');

test('weekly targets: KCCI primary, SCFI secondary, ocean/weekly', () => {
  const codes = WEEKLY_TARGETS.map((t) => t.metric_ref);
  assert.deepEqual(codes, ['KCCI', 'SCFI']);
  assert.ok(WEEKLY_TARGETS.every((t) => t.mode === 'ocean' && t.cadence === 'weekly'));
});
test('horizonDate: asof + weeks', () => {
  assert.equal(horizonDate(new Date('2026-06-05T00:00:00Z'), 4), '2026-07-03');
});
test('major dest keywords non-empty', () => {
  assert.ok(MAJOR_DEST_KEYWORDS.length >= 2);
});
