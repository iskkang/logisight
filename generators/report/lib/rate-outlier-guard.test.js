'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { carryForwardOutliers } = require('./rate-outlier-guard');

const SEA = ['feu', 'teu'];
const SEA_CHG = { feu: 'feuChg', teu: 'teuChg' };

test('carries forward an upward outlier (>=150%) to previous month', () => {
  const rates = [
    { yearMon: '202605', feu: 50, feuChg: 0 },
    { yearMon: '202606', feu: 459, feuChg: 409 },
  ];
  const corr = carryForwardOutliers(rates, SEA, SEA_CHG);
  assert.equal(rates[1].feu, 50); // 전월값 사용
  assert.equal(rates[1].feuChg, 0); // 변동분 0으로
  assert.deepEqual(corr, [{ yearMon: '202606', field: 'feu', from: 459, to: 50 }]);
});

test('leaves a legitimate surge under threshold untouched (+109%)', () => {
  const rates = [
    { yearMon: '202605', feu: 2300 },
    { yearMon: '202606', feu: 4800 },
  ];
  const corr = carryForwardOutliers(rates, SEA, SEA_CHG);
  assert.equal(rates[1].feu, 4800);
  assert.equal(corr.length, 0);
});

test('threshold is inclusive at exactly 150% (x2.5)', () => {
  const rates = [
    { yearMon: '202605', feu: 100 },
    { yearMon: '202606', feu: 250 },
  ];
  carryForwardOutliers(rates, SEA, SEA_CHG);
  assert.equal(rates[1].feu, 100);
});

test('a bad value does not corrupt the chain (compares to last accepted)', () => {
  const rates = [
    { yearMon: '202604', feu: 50 },
    { yearMon: '202605', feu: 459 }, // outlier -> carried to 50
    { yearMon: '202606', feu: 60 }, // +20% vs 50 -> kept
  ];
  carryForwardOutliers(rates, SEA, SEA_CHG);
  assert.deepEqual(rates.map((r) => r.feu), [50, 50, 60]);
});

test('first month cannot be flagged (no previous baseline)', () => {
  const rates = [{ yearMon: '202601', feu: 9999 }];
  const corr = carryForwardOutliers(rates, SEA, SEA_CHG);
  assert.equal(corr.length, 0);
  assert.equal(rates[0].feu, 9999);
});

test('skips nulls and treats first non-null as baseline', () => {
  const rates = [
    { yearMon: '202604', feu: null },
    { yearMon: '202605', feu: 50 },
    { yearMon: '202606', feu: 5000 }, // vs 50 -> carried
  ];
  carryForwardOutliers(rates, SEA, SEA_CHG);
  assert.equal(rates[2].feu, 50);
});

test('processes in yearMon order regardless of input order', () => {
  const rates = [
    { yearMon: '202606', feu: 459 },
    { yearMon: '202605', feu: 50 },
  ];
  carryForwardOutliers(rates, SEA, SEA_CHG);
  const jun = rates.find((r) => r.yearMon === '202606');
  assert.equal(jun.feu, 50);
});

test('handles multiple fields independently (air kg100/300/500)', () => {
  const rates = [
    { yearMon: '202605', kg300: 5, kg100: 6 },
    { yearMon: '202606', kg300: 50, kg100: 6.5 }, // kg300 outlier, kg100 fine
  ];
  carryForwardOutliers(rates, ['kg100', 'kg300', 'kg500'], { kg300: 'chg300' });
  assert.equal(rates[1].kg300, 5);
  assert.equal(rates[1].kg100, 6.5);
});
