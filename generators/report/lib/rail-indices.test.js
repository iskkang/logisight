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

// ── 편수 파싱 ───────────────────────────────────────────────────────────────
// 2026-08호에서 신장 두 통관구(阿拉山口·霍尔果斯) 기사가 50편으로 실렸다.
// 제목은 「超万列」(1만 편 초과)인데 万 을 못 읽어 본문의 다른 "50列"을 집었다.
// 국경 통과량의 핵심 계열이라 여기가 틀리면 철도 섹션 전체가 어긋난다.
const { extractStats } = require('./rail-indices');

test('万 이 붙은 편수를 읽는다', () => {
  assert.equal(extractStats('新疆双口岸今年通行中欧（亚）班列超万列').trainCount, 10000);
  assert.equal(extractStats('累计开行中欧班列1.5万列').trainCount, 15000);
  assert.equal(extractStats('突破2万趟').trainCount, 20000);
});

// 万 패턴이 앞서더라도 평범한 편수를 가로채면 안 된다.
test('万 이 없는 편수는 그대로 읽는다', () => {
  assert.equal(extractStats('累计开行中欧班列1,556列').trainCount, 1556);
  assert.equal(extractStats('上半年经满洲里铁路口岸进出境中欧班列2962列').trainCount, 2962);
});

// 이것이 실제로 일어난 오독이다. 万 기사에서 본문의 작은 숫자를 집으면 안 된다.
test('万 기사에서 본문의 다른 숫자를 집지 않는다', () => {
  const t = '新疆双口岸今年通行中欧（亚）班列超万列。其中某站单日最高50列。';
  assert.equal(extractStats(t).trainCount, 10000);
});

test('편수가 없으면 비워 둔다', () => {
  assert.equal(extractStats('中欧班列高质量发展取得显著成效').trainCount, undefined);
});
