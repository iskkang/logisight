'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { dropOutliers } = require('./rate-outlier-guard');

const SEA = ['feu', 'teu'];
const SEA_CHG = { feu: 'feuChg', teu: 'teuChg' };

test('이상치(>=150%)는 전월값으로 바꾸지 않고 버린다', () => {
  const rates = [
    { yearMon: '202605', feu: 50, feuChg: 0 },
    { yearMon: '202606', feu: 459, feuChg: 409 },
  ];
  const corr = dropOutliers(rates, SEA, SEA_CHG);
  assert.equal(rates[1].feu, null); // 전월값 50 을 채워 넣지 않는다
  assert.equal(rates[1].feuChg, null); // 0 도 아니다 — 0 은 "변화 없었다"는 관측이다
  assert.deepEqual(corr, [{ yearMon: '202606', field: 'feu', dropped: 459, comparedTo: 50 }]);
});

test('임계 미만의 정상 급등(+109%)은 건드리지 않는다', () => {
  const rates = [
    { yearMon: '202605', feu: 2300 },
    { yearMon: '202606', feu: 4800 },
  ];
  const corr = dropOutliers(rates, SEA, SEA_CHG);
  assert.equal(rates[1].feu, 4800);
  assert.equal(corr.length, 0);
});

test('임계는 정확히 150%(x2.5)에서 포함', () => {
  const rates = [
    { yearMon: '202605', feu: 100 },
    { yearMon: '202606', feu: 250 },
  ];
  dropOutliers(rates, SEA, SEA_CHG);
  assert.equal(rates[1].feu, null);
});

test('버린 값은 기준선이 되지 못한다 (마지막 인정값과 비교)', () => {
  const rates = [
    { yearMon: '202604', feu: 50 },
    { yearMon: '202605', feu: 459 }, // 이상치 → 버림
    { yearMon: '202606', feu: 60 }, // 50 대비 +20% → 유지
  ];
  dropOutliers(rates, SEA, SEA_CHG);
  assert.deepEqual(rates.map((r) => r.feu), [50, null, 60]);
});

test('첫 달은 판정 불가 (비교할 직전값이 없다)', () => {
  const rates = [{ yearMon: '202601', feu: 9999 }];
  const corr = dropOutliers(rates, SEA, SEA_CHG);
  assert.equal(corr.length, 0);
  assert.equal(rates[0].feu, 9999);
});

test('null 은 건너뛰고 첫 비-null 을 기준선으로 삼는다', () => {
  const rates = [
    { yearMon: '202604', feu: null },
    { yearMon: '202605', feu: 50 },
    { yearMon: '202606', feu: 5000 }, // 50 대비 → 버림
  ];
  dropOutliers(rates, SEA, SEA_CHG);
  assert.equal(rates[2].feu, null);
});

test('입력 순서와 무관하게 yearMon 순으로 처리', () => {
  const rates = [
    { yearMon: '202606', feu: 459 },
    { yearMon: '202605', feu: 50 },
  ];
  dropOutliers(rates, SEA, SEA_CHG);
  const jun = rates.find((r) => r.yearMon === '202606');
  assert.equal(jun.feu, null);
});

test('필드별로 독립 판정 (항공 kg100/300/500)', () => {
  const rates = [
    { yearMon: '202605', kg300: 5, kg100: 6 },
    { yearMon: '202606', kg300: 50, kg100: 6.5 }, // kg300 만 이상치
  ];
  dropOutliers(rates, ['kg100', 'kg300', 'kg500'], { kg300: 'chg300' });
  assert.equal(rates[1].kg300, null);
  assert.equal(rates[1].kg100, 6.5);
});
