'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { pearson, leadLagScan, wowSeries } = require('./scfi-kcci-backtest');

test('pearson: perfect positive → 1', () => {
  assert.equal(pearson([1, 2, 3, 4], [2, 4, 6, 8]), 1);
});
test('pearson: <3 points → null', () => {
  assert.equal(pearson([1, 2], [1, 2]), null);
});

test('wowSeries: WoW% from ascending values', () => {
  assert.deepEqual(wowSeries([1000, 1100, 1210]), [10, 10]);
});

test('leadLagScan: SCFI leading KCCI by 2 → max corr at lag 2', () => {
  const scfi = [3, -2, 5, 1, 4, -1, 2, 6];
  const kcci = [0, 0, 3, -2, 5, 1, 4, -1]; // SCFI를 2 시프트
  const scan = leadLagScan(scfi, kcci, 4);
  const best = scan.filter((s) => s.corr != null).sort((a, b) => Math.abs(b.corr) - Math.abs(a.corr))[0];
  assert.equal(best.lag, 2);
});
