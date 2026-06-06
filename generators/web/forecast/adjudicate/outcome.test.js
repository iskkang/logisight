'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyOutcome } = require('./outcome');

// up, 예측 범위 +3~7
const up = { direction: 'up', range_low_pct: 3, range_high_pct: 7 };
test('up: realized within band → hit', () => {
  assert.equal(classifyOutcome(up, 5), 'hit');
  assert.equal(classifyOutcome(up, 3), 'hit');
  assert.equal(classifyOutcome(up, 7), 'hit');
});
test('up: right direction, outside band → partial', () => {
  assert.equal(classifyOutcome(up, 1.5), 'partial'); // 올랐지만 밴드 미만
  assert.equal(classifyOutcome(up, 9), 'partial');   // 예상보다 더 상승
});
test('up: wrong direction (<=0) → miss', () => {
  assert.equal(classifyOutcome(up, 0), 'miss');
  assert.equal(classifyOutcome(up, -2), 'miss');
});

// down, 예측 범위 -7~-3
const down = { direction: 'down', range_low_pct: -7, range_high_pct: -3 };
test('down: within band → hit', () => {
  assert.equal(classifyOutcome(down, -5), 'hit');
});
test('down: right direction, outside band → partial', () => {
  assert.equal(classifyOutcome(down, -1), 'partial');
  assert.equal(classifyOutcome(down, -9), 'partial');
});
test('down: wrong direction (>=0) → miss', () => {
  assert.equal(classifyOutcome(down, 0), 'miss');
  assert.equal(classifyOutcome(down, 2), 'miss');
});

// flat (range null) — ±1% 이내 적중
const flat = { direction: 'flat', range_low_pct: null, range_high_pct: null };
test('flat: |realized|<=1 → hit, else miss', () => {
  assert.equal(classifyOutcome(flat, 0.5), 'hit');
  assert.equal(classifyOutcome(flat, -1), 'hit');
  assert.equal(classifyOutcome(flat, 3), 'miss');
});
test('null realized → null (cannot judge)', () => {
  assert.equal(classifyOutcome(up, null), null);
});
