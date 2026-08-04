'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseHeadline } = require('./drewry-headline');

// Drewry는 메타 description의 문구를 예고 없이 바꾼다. 분모를 못 읽으면 비율이
// null이 되고, persist가 리딩 전체를 버린다 — 수집은 "OK"로 찍히는데 값만 사라져
// 원인이 보이지 않는다. 실제로 그 상태로 3주를 흘려보냈다(2026-07-17 이후 정체).
// 두 문구를 모두 고정해 둔다.

const page = (desc) =>
  `<html><head><title>Cancelled Sailings Tracker - 31 Jul 2026</title>`
  + `<meta name="description" content="${desc}"></head><body></body></html>`;

// 2026-08 시점의 실제 문구.
const CURRENT = '31 Jul 2026: Across the major East–West trades, 58 blank sailings are expected '
  + 'from week 32 (3-9 August) to week 36 (31 August-6 September), out of 723 planned sailings.';

// 그 이전 문구.
const LEGACY = '17 Jul 2026: Across the major East–West trades, 39 blank sailings are expected '
  + 'over the next five weeks, out of 780 scheduled departures.';

test('parseHeadline: 현재 문구("planned sailings")의 분모를 읽는다', () => {
  const h = parseHeadline(page(CURRENT));
  assert.equal(h.blank, 58);
  assert.equal(h.scheduled, 723);
  assert.equal(h.pct, 8);
});

test('parseHeadline: 이전 문구("scheduled departures")도 계속 읽는다', () => {
  const h = parseHeadline(page(LEGACY));
  assert.equal(h.blank, 39);
  assert.equal(h.scheduled, 780);
  assert.equal(h.pct, 5);
});

test('parseHeadline: 천단위 쉼표를 받는다', () => {
  const h = parseHeadline(page('1 Aug 2026: 120 blank sailings are expected, out of 1,240 planned sailings.'));
  assert.equal(h.scheduled, 1240);
});

// 분모가 없어도 문장에 비율이 있으면 그것을 쓴다.
test('parseHeadline: 분모가 없으면 명시된 비율을 인용한다', () => {
  const h = parseHeadline(page('1 Aug 2026: an 8.5% cancellation rate is expected. 60 blank sailings.'));
  assert.equal(h.scheduled, null);
  assert.equal(h.pct, 8.5);
});

test('parseHeadline: description이 없으면 null', () => {
  assert.equal(parseHeadline('<html><head></head><body></body></html>'), null);
});

test('parseHeadline: as_of 문자열을 문장 앞에서 잡는다', () => {
  assert.equal(parseHeadline(page(CURRENT)).sentence.startsWith('31 Jul 2026'), true);
});
