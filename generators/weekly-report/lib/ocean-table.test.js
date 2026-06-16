'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildOceanTable } = require('./ocean-table');

const rows = [
  { code: 'SCFI', value: 2985.22, week_date: '2026-06-08', unit: 'point', wow: 9.5 },
  { code: 'KCCI', value: 3042, week_date: '2026-06-08', unit: 'point', wow: 13.7 },
  { code: 'BDI', value: 3114, week_date: '2026-06-01', unit: 'point', wow: -3.5 },
];
test('renders index rows with WoW arrows and basis date', () => {
  const { table } = buildOceanTable(rows);
  assert.match(table, /SCFI 종합/);
  assert.match(table, /▲ \+9\.5%/);
  assert.match(table, /▼ -3\.5%/);
  assert.match(table, /06\/08/);
});
test('null rows -> honest placeholder', () => {
  assert.match(buildOceanTable(null).table, /미수집/);
});
