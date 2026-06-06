'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseDrewryAsOf } = require('./drewry-blank');

test('parseDrewryAsOf: "05 Jun 2026: ..." → 2026-06-05', () => {
  assert.equal(
    parseDrewryAsOf({ sentence: '05 Jun 2026: Across major East–West trades, 39 blank sailings...' }),
    '2026-06-05',
  );
});
test('parseDrewryAsOf: full month name', () => {
  assert.equal(parseDrewryAsOf({ sentence: '5 June 2026: ...' }), '2026-06-05');
});
test('parseDrewryAsOf: no date → null', () => {
  assert.equal(parseDrewryAsOf({ sentence: 'no date here' }), null);
});
