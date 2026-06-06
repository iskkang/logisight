'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { composite, classify, confidence } = require('./score');
const { WEIGHTS } = require('./config/forecast-model');

test('composite: all-present ocean reproduces worked example 1.35', () => {
  const scores = { momentum: 2, supply: 1, demand: 1, cost: 1, pricing: 2 };
  assert.equal(composite(scores, WEIGHTS.ocean), 1.35);
});
test('composite: reweights over present factors when some missing', () => {
  // momentum=2 present, others null → renormalize → 2
  const scores = { momentum: 2, supply: null, demand: null, cost: null, pricing: null };
  assert.equal(composite(scores, WEIGHTS.ocean), 2);
});
test('composite: all missing → null', () => {
  const scores = { momentum: null, supply: null, demand: null, cost: null, pricing: null };
  assert.equal(composite(scores, WEIGHTS.ocean), null);
});

test('classify: boundaries match doc (+0.4 up, -0.4 down, open flat)', () => {
  assert.equal(classify(1.35).direction, 'up');
  assert.equal(classify(0.4).direction, 'up');
  assert.equal(classify(0.39).direction, 'flat');
  assert.equal(classify(-0.4).direction, 'down');
  assert.equal(classify(-0.39).direction, 'flat');
  assert.equal(classify(-0.9).strength, '하락 가능성 높음');
  assert.deepEqual(classify(1.35).range, [3, 7]);
  assert.equal(classify(0).range, null);
});

test('confidence: 5 present, signs aligned → high', () => {
  const scores = { momentum: 2, supply: 1, demand: 1, cost: 1, pricing: 2 };
  assert.equal(confidence(scores, WEIGHTS.ocean), 'high');
});
test('confidence: 2+ missing → low', () => {
  const scores = { momentum: 2, supply: 1, demand: null, cost: null, pricing: 2 };
  assert.equal(confidence(scores, WEIGHTS.ocean), 'low');
});
test('confidence: vulnerable rally (supply>=1 & demand<=-1) → medium', () => {
  const scores = { momentum: 1, supply: 1, demand: -1, cost: 0, pricing: 1 };
  assert.equal(confidence(scores, WEIGHTS.ocean), 'medium');
});
test('confidence: 4 present + aligned but 1 missing → medium (high requires all 5)', () => {
  const scores = { momentum: 2, supply: 1, demand: 1, cost: null, pricing: 2 };
  assert.equal(confidence(scores, WEIGHTS.ocean), 'medium');
});
