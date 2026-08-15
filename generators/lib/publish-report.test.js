'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const { isoWeekOf } = require('./publish-report');

// 주간 리포트 영구링크(/reports/weekly/2026-W32)의 파라미터가 이 값이다.
// 지금까지 reports.iso_week 가 전부 null 이라 sitemap 이 개별 호를 실을 수 없었다.

test('발행 라벨과 맞는다 (2026-08-03 = "32주차")', () => {
  assert.equal(isoWeekOf('2026-08-03'), '2026-W32');
  assert.equal(isoWeekOf('2026-07-27'), '2026-W31');
});

// ISO 규칙의 핵심 —— 그 주의 목요일이 속한 해가 그 주의 연도다.
// 연말연시에 달력 연도와 주차 연도가 어긋난다. 여기서 틀리면 링크가 없는 주차를 가리킨다.
test('연말이 다음 해 W01 로 넘어간다', () => {
  assert.equal(isoWeekOf('2025-12-29'), '2026-W01'); // 월요일, 목요일은 2026-01-01
});

test('연초가 지난 해 마지막 주에 남는다', () => {
  assert.equal(isoWeekOf('2027-01-03'), '2026-W53'); // 일요일, 목요일은 2026-12-31
});

test('주차는 두 자리로 채운다', () => {
  assert.equal(isoWeekOf('2026-01-01'), '2026-W01');
  assert.match(isoWeekOf('2026-03-02'), /^\d{4}-W\d{2}$/);
});

test('같은 주의 월~일은 모두 같은 주차다', () => {
  const week = isoWeekOf('2026-08-03');
  for (const d of ['2026-08-03', '2026-08-05', '2026-08-09']) {
    assert.equal(isoWeekOf(d), week);
  }
});

test('날짜가 아니면 null 이다 (아무 값이나 지어내지 않는다)', () => {
  assert.equal(isoWeekOf('없음'), null);
  assert.equal(isoWeekOf(''), null);
});
