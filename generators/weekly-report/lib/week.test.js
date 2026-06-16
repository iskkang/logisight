// generators/weekly-report/lib/week.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { isoWeek, reportingPeriod } = require('./week');

test('isoWeek: Sunday 2026-06-14 is 2026-W24', () => {
  const w = isoWeek(new Date('2026-06-14T05:00:00Z'));
  assert.equal(w.id, '2026-W24');
  assert.equal(w.week, 24);
  assert.equal(w.year, 2026);
});

test('reportingPeriod: week containing 2026-06-14 is Mon 06/08 .. Sun 06/14', () => {
  const p = reportingPeriod(new Date('2026-06-14T05:00:00Z'));
  assert.equal(p.start, '06/08');
  assert.equal(p.end, '06/14');
  assert.equal(p.startISO, '2026-06-08');
  assert.equal(p.endISO, '2026-06-14');
});

test('reportingPeriod: a Wednesday still maps to its Mon..Sun', () => {
  const p = reportingPeriod(new Date('2026-06-10T00:00:00Z'));
  assert.equal(p.startISO, '2026-06-08');
  assert.equal(p.endISO, '2026-06-14');
});
