'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { RELEASE_CALENDAR, nextDue } = require('./data-release-calendar');

test('calendar covers the SSOT datasets', () => {
  const ids = RELEASE_CALENDAR.map((r) => r.id);
  for (const k of ['kcta_provisional', 'kcta_final', 'kcci_weekly', 'drewry_blank', 'drewry_diversion', 'iata_jet']) {
    assert.ok(ids.includes(k), `missing ${k}`);
  }
});

test('nextDue: monthly day-of-month → next occurrence on/after asof', () => {
  const r = { cadence: 'monthly', day_of_month: 15 };
  assert.equal(nextDue(r, new Date('2026-06-06T00:00:00Z')), '2026-06-15');
  assert.equal(nextDue(r, new Date('2026-06-20T00:00:00Z')), '2026-07-15');
});

test('nextDue: weekly Friday → next Friday (Drewry blank)', () => {
  // 2026-06-07 = 일요일 → 다음 금요일 2026-06-12
  assert.equal(nextDue({ cadence: 'weekly', weekday: 5 }, new Date('2026-06-07T00:00:00Z')), '2026-06-12');
});

test('nextDue: unverified weekday / biweekly → null', () => {
  assert.equal(nextDue({ cadence: 'weekly', weekday: null }, new Date('2026-06-07T00:00:00Z')), null);
  assert.equal(nextDue({ cadence: 'biweekly', weekday: null }, new Date('2026-06-07T00:00:00Z')), null);
});
