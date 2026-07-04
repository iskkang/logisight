'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseIndexValue, parseFromTo, discoverLatestIsl } = require('./port-throughput');

// 실제 ISL 월별 보도자료(2026-05) 문장
const ISL_MAY = 'the RWI/ISL Container Throughput Index increased by 0.3 points from 141.6 (revised) to 141.9 index points. The Nordrange Index rose from 119.6 points (revised) to 120.0 points, while the index for Chinese ports fell from 158.9 to 157.6 points.';

test('parseIndexValue: "X index points" 표현에서 글로벌 지수 추출', () => {
  assert.equal(parseIndexValue(ISL_MAY), 141.9);
});

test('parseIndexValue: "index stood at" 표현도 지원', () => {
  assert.equal(parseIndexValue('The index stood at 138.2 points in April.'), 138.2);
});

test('parseIndexValue: 값 없으면 null', () => {
  assert.equal(parseIndexValue('no index numbers here'), null);
});

test('parseIndexValue: 범위 밖(작은 수) 무시', () => {
  assert.equal(parseIndexValue('increased by 0.3 points'), null);
});

test('parseFromTo: "from A (revised) to B" → prev/curr 추출(MoM 계산 근거)', () => {
  assert.deepEqual(parseFromTo(ISL_MAY), { prev: 141.6, curr: 141.9 });
});

test('parseFromTo: 매칭 없으면 null', () => {
  assert.equal(parseFromTo('the index reached 141.9 index points'), null);
});

test('discoverLatestIsl: 랜딩에서 가장 최근(YY,M) 월 링크 선택', () => {
  const html = '<a href="/en/services/rwiisl-container-throughput-index-426">Apr26</a>'
             + '<a href="/en/services/rwiisl-container-throughput-index-526">May26</a>'
             + '<a href="/en/services/rwiisl-container-throughput-index-1225">Dec25</a>';
  assert.equal(
    discoverLatestIsl(html),
    'https://www.isl.org/en/services/rwiisl-container-throughput-index-526',
  );
});

test('discoverLatestIsl: 월 링크 없으면 null', () => {
  assert.equal(discoverLatestIsl('<a href="/en/services/other-page">x</a>'), null);
});
