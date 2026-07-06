'use strict';
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('fs');
const { saveForecasts, loadForecasts, forecastsPath } = require('./forecast-store');

const TEST_MONTH = '1999-01';   // 실제 리포트와 겹치지 않는 더미 월

test.after(() => {
  const dir = require('path').dirname(forecastsPath(TEST_MONTH));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('save → load 라운드트립', () => {
  const claims = [
    { section: 'ocean', claim: 'SCFI는 다음 달 강보합 예상', metric: 'SCFI', direction: 'up', horizon: 'M+1' },
  ];
  const filePath = saveForecasts(TEST_MONTH, claims);
  assert.ok(fs.existsSync(filePath));
  assert.deepEqual(loadForecasts(TEST_MONTH), claims);
});

test('없는 월은 null', () => {
  assert.equal(loadForecasts('1900-01'), null);
});

test('손상된 JSON은 null (throw 안 함)', () => {
  const filePath = forecastsPath(TEST_MONTH);
  fs.mkdirSync(require('path').dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, '{ not valid json', 'utf-8');
  assert.equal(loadForecasts(TEST_MONTH), null);
});
