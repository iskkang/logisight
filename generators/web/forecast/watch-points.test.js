'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildWatchPoints } = require('./watch-points');

test('buildWatchPoints: demand/supply/china → due 포함 항목', () => {
  const input = {
    demand: { region: 'EU' },
    supply: { blank_sailing: { source_type: 'tracker_quoted' } },
    china_factor: {},
  };
  const wp = buildWatchPoints(input, new Date('2026-06-07T00:00:00Z'));
  assert.ok(wp.length >= 2);
  assert.equal(wp.every((w) => w.due && w.label && w.source), true);
});
test('buildWatchPoints: supply 결측(none) → 결항 watch 제외', () => {
  const wp = buildWatchPoints({ supply: { blank_sailing: { source_type: 'none' } } }, new Date('2026-06-07T00:00:00Z'));
  assert.equal(wp.some((w) => /결항/.test(w.label)), false);
});
