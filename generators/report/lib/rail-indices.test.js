'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildTable } = require('./rail-indices');

// 품질 계약 5조: 개별 거점 수치를 네트워크 전체처럼 라벨하지 않는다
const ARTICLES = [
  { titleKo: '정저우 국제육항, 상반기 중국-유럽 화물열차 1,556편 발송', stats: { trainCount: 1556, yoy: 25.7 } },
  { titleKo: '우한, 상반기 화물가치 1억 달러 돌파', stats: { trainCount: 520, valueYi: 1.0, yoy: 21.3 } },
  { titleKo: '통계 없는 기사', stats: {} },
];

test('기사별 행 — 각 행에 자기 자신의 YoY (도시 간 평균·최대값 집계 금지)', () => {
  const t = buildTable(ARTICLES, '2026-07');
  assert.match(t, /정저우[^\n|]*\|\s*\*\*1,556편\*\*\s*\|\s*▲25\.7%/);
  assert.match(t, /우한[^\n|]*\|\s*\*\*520편 · 1\.0억USD\*\*\s*\|\s*▲21\.3%/);
  assert.doesNotMatch(t, /중국-유럽 화물열차 운행편수/);   // 전체 네트워크식 라벨 금지
});

test('범위 명시 각주 포함', () => {
  const t = buildTable(ARTICLES, '2026-07');
  assert.match(t, /네트워크 전체 합계가 아님/);
  assert.match(t, /2026-07 수집 기사 기준/);
});

test('stats 있는 기사가 없으면 null', () => {
  assert.equal(buildTable([{ titleKo: 'x', stats: {} }], '2026-07'), null);
});
