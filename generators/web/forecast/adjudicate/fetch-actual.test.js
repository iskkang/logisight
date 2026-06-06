'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseMetricRef, pickRealized } = require('./fetch-actual');

test('parseMetricRef: freight index code', () => {
  assert.deepEqual(parseMetricRef('KCCI'), { kind: 'index', code: 'KCCI' });
});
test('parseMetricRef: kita lane', () => {
  assert.deepEqual(parseMetricRef('kita_sea_rates:부산-로스앤젤레스'),
    { kind: 'kita', origin: '부산', dest: '로스앤젤레스' });
});

test('pickRealized: first row on/after horizon (rows desc by date)', () => {
  const rows = [
    { value: 1300, date: '2026-07-06' },
    { value: 1280, date: '2026-07-03' }, // == horizon
    { value: 1200, date: '2026-06-26' },
  ];
  assert.equal(pickRealized(rows, '2026-07-03'), 1280);
});
test('pickRealized: none on/after horizon → null (아직 도래 안함)', () => {
  const rows = [{ value: 1200, date: '2026-06-26' }];
  assert.equal(pickRealized(rows, '2026-07-03'), null);
});
