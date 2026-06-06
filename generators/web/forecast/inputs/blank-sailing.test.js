'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildBlankSailing } = require('./blank-sailing');

const asof = new Date('2026-06-05T00:00:00Z');

test('rising blank_pct → expanding, ratio carried, tracker_quoted', () => {
  const rows = [
    { week_start: '2026-06-01', blank_pct: 12, source: 'Drewry' },
    { week_start: '2026-05-25', blank_pct: 8, source: 'Drewry' },
  ];
  const bs = buildBlankSailing(rows, asof);
  assert.equal(bs.source_type, 'tracker_quoted');
  assert.equal(bs.ratio_pct, 12);
  assert.equal(bs.direction, 'expanding');
  assert.equal(bs.magnitude_class, 'moderate'); // 7..15
  assert.equal(bs.geo_scope, 'trade_level_proxy');
  assert.equal(bs.signal_age_days, 4);
});
test('falling blank_pct → easing; >=15 major', () => {
  const rows = [
    { week_start: '2026-06-01', blank_pct: 16 },
    { week_start: '2026-05-25', blank_pct: 20 },
  ];
  const bs = buildBlankSailing(rows, asof);
  assert.equal(bs.direction, 'easing');
  assert.equal(bs.magnitude_class, 'major');
});
test('flat (±1pp) → stable', () => {
  const bs = buildBlankSailing([{ week_start: '2026-06-01', blank_pct: 6 }, { week_start: '2026-05-25', blank_pct: 6.5 }], asof);
  assert.equal(bs.direction, 'stable');
  assert.equal(bs.magnitude_class, 'minor');
});
test('no rows → source_type none', () => {
  assert.equal(buildBlankSailing([], asof).source_type, 'none');
});
