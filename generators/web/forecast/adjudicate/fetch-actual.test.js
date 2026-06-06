'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseMetricRef, pickRealized, fetchActual } = require('./fetch-actual');

function kitaSupabase(rows) {
  const api = { select() { return api; }, eq() { return api; }, order() { return api; }, limit() { return Promise.resolve({ data: rows }); } };
  return { from() { return api; } };
}

test('parseMetricRef: freight index code', () => {
  assert.deepEqual(parseMetricRef('KCCI'), { kind: 'index', code: 'KCCI' });
});
test('parseMetricRef: kita lane', () => {
  assert.deepEqual(parseMetricRef('kita_sea_rates:부산-로스앤젤레스'),
    { kind: 'kita', origin: '부산', dest: '로스앤젤레스' });
});
test('parseMetricRef: kita lane with hyphen in dest (split on first hyphen only)', () => {
  assert.deepEqual(parseMetricRef('kita_sea_rates:부산-Los-Angeles'),
    { kind: 'kita', origin: '부산', dest: 'Los-Angeles' });
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

test('fetchActual: kita 월간 — horizon 월 중순이면 그 달(월말 정규화) 실측 선택', async () => {
  const rows = [
    { feu: 2400, year_mon: '202608' },
    { feu: 2300, year_mon: '202607' }, // 7월 — horizon 2026-07-05가 속한 달
    { feu: 2900, year_mon: '202606' },
  ];
  const v = await fetchActual(kitaSupabase(rows), 'kita_sea_rates:부산-함부르크', '2026-07-05');
  assert.equal(v, 2300); // 월초 정규화였다면 7월말<horizon이 아니라 7월초<horizon으로 8월(2400) 오판됐을 것
});
