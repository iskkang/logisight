'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const SECTIONS = require('./sections.config');

test('exactly 5 sections in fixed order', () => {
  assert.deepEqual(SECTIONS.map(s => s.id), ['overview', 'ocean', 'air', 'logistics', 'trade']);
});
test('ocean section tracks freight indices and has keywords', () => {
  const ocean = SECTIONS.find(s => s.id === 'ocean');
  assert.equal(ocean.table, 'ocean');
  assert.ok(ocean.keywords.includes('freight'));
});
test('logistics and trade have no injected table', () => {
  assert.equal(SECTIONS.find(s => s.id === 'logistics').table, null);
  assert.equal(SECTIONS.find(s => s.id === 'trade').table, null);
});
