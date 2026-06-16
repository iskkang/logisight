'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildAirTable } = require('./air-table');

const iata = {
  data: {
    asOf: '2026-06',
    headline: { clf_level: 46, clf_ppt: 1.9 },
    regions: [
      { region: '전체(글로벌)', ctk_yoy: 4, actk_yoy: -0.4 },
      { region: '중동', ctk_yoy: -18.2, actk_yoy: -22.9 },
    ],
  },
};
test('builds markdown table with region rows and source line', () => {
  const { table, factText } = buildAirTable(iata);
  assert.match(table, /전체\(글로벌\)/);
  assert.match(table, /\+4/);
  assert.match(table, /-18\.2/);
  assert.match(factText, /2026-06/);
});
test('missing data returns honest placeholder', () => {
  const { table } = buildAirTable(null);
  assert.match(table, /미수집/);
});
