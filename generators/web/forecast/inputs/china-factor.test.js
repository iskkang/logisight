'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildChinaFactor, pct2w } = require('./china-factor');

function series(vals) { return vals.map((v) => ({ value: v, date: 'x' })); }

test('pct2w: 2-week cumulative % (idx0 vs idx2)', () => {
  assert.equal(pct2w(series([1060, 1030, 1000])), 6); // (1060-1000)/1000
  assert.equal(pct2w(series([1000, 1000])), null); // <3 points
});

test('buildChinaFactor: SCFI outpacing KCCI → widening', () => {
  const scfi = series([1100, 1050, 1000]); // +10% 2w
  const kcci = series([1010, 1005, 1000]); // +1% 2w
  const cf = buildChinaFactor(scfi, kcci);
  assert.equal(cf.scfi_mom_pct, 10);
  assert.equal(cf.scfi_vs_kr_spread, 'widening');
  assert.equal(cf.china_export_signal, null);
  assert.ok(cf.evidence.length >= 1);
});
test('buildChinaFactor: KCCI catching up → narrowing', () => {
  const scfi = series([1010, 1005, 1000]); // +1%
  const kcci = series([1100, 1050, 1000]); // +10%
  assert.equal(buildChinaFactor(scfi, kcci).scfi_vs_kr_spread, 'narrowing');
});
test('buildChinaFactor: similar momentum → stable', () => {
  const scfi = series([1030, 1015, 1000]);
  const kcci = series([1030, 1015, 1000]);
  assert.equal(buildChinaFactor(scfi, kcci).scfi_vs_kr_spread, 'stable');
});
test('buildChinaFactor: insufficient data → nulls', () => {
  const cf = buildChinaFactor(series([1000]), series([1000]));
  assert.equal(cf.scfi_mom_pct, null);
  assert.equal(cf.scfi_vs_kr_spread, null);
});
