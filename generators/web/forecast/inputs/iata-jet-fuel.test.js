'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseIataHeadline, buildIataFuel, SOURCE_ATTRIBUTION } = require('./iata-jet-fuel');

// ── parseIataHeadline — 실제 페이지 HTML 구조 기반 ──────────────────────────

// 실제 IATA 페이지에서 확인된 문장 패턴 (2026-06-07 접속):
// "The global average jet fuel price last week fell 11.4% compared to the week before to $141.64/bbl."
const REAL_SENTENCE =
  '<h3 class="iataElement-Title3">Fuel Price Analysis</h3>' +
  '<p>The global average jet fuel price<span> </span>' +
  '<span>last week fell 11.4% compared to the week before to $141.64/bbl.</span></p>';

test('parseIataHeadline: 실제 페이지 패턴(fell) — price + WoW 추출', () => {
  const r = parseIataHeadline(REAL_SENTENCE);
  assert.ok(r, '결과가 null이면 안 됨');
  assert.equal(r.price_usd_bbl, 141.64);
  assert.equal(r.fuel_wow_pct, -11.4);  // fell → 음수
  assert.equal(r.span_label, 'weekly'); // MoM 위장 금지 확인
  assert.equal(r.source, SOURCE_ATTRIBUTION);
});

test('parseIataHeadline: rose 패턴', () => {
  const html =
    '<p>The global average jet fuel price last week rose 3.2% compared to the week before to $155.00/bbl.</p>';
  const r = parseIataHeadline(html);
  assert.ok(r);
  assert.equal(r.price_usd_bbl, 155.0);
  assert.equal(r.fuel_wow_pct, 3.2);
  assert.equal(r.span_label, 'weekly');
});

test('parseIataHeadline: unchanged 패턴 → fuel_wow_pct = 0', () => {
  const html =
    '<p>The global average jet fuel price last week was unchanged compared to the week before to $150.00/bbl.</p>';
  const r = parseIataHeadline(html);
  assert.ok(r);
  assert.equal(r.price_usd_bbl, 150.0);
  assert.equal(r.fuel_wow_pct, 0);
});

test('parseIataHeadline: 변화율 없고 가격만 있는 경우 — price 반환, wowPct null', () => {
  const html =
    '<p>The global average jet fuel price last week to $160.00/bbl.</p>';
  const r = parseIataHeadline(html);
  // 가격 파싱은 되어야 하지만 변화율은 null
  assert.ok(r);
  assert.equal(r.price_usd_bbl, 160.0);
  assert.equal(r.fuel_wow_pct, null);
});

test('parseIataHeadline: 페이지 구조 없음 → null', () => {
  assert.equal(parseIataHeadline('<p>No relevant content here.</p>'), null);
});

test('parseIataHeadline: null 입력 → null', () => {
  assert.equal(parseIataHeadline(null), null);
});

test('parseIataHeadline: 빈 문자열 → null', () => {
  assert.equal(parseIataHeadline(''), null);
});

test('parseIataHeadline: 가격이 0 또는 음수 → null (유효성 검증)', () => {
  const html =
    '<p>The global average jet fuel price last week fell 5% compared to the week before to $0.00/bbl.</p>';
  assert.equal(parseIataHeadline(html), null);
});

test('parseIataHeadline: 소수 없는 정수 가격', () => {
  const html =
    '<p>The global average jet fuel price last week rose 2% compared to the week before to $200/bbl.</p>';
  const r = parseIataHeadline(html);
  assert.ok(r);
  assert.equal(r.price_usd_bbl, 200.0);
  assert.equal(r.fuel_wow_pct, 2.0);
});

test('parseIataHeadline: span_label은 항상 "weekly" — MoM 위장 방지', () => {
  const r = parseIataHeadline(REAL_SENTENCE);
  assert.equal(r.span_label, 'weekly');
  assert.notEqual(r.span_label, 'monthly');
});

// ── buildIataFuel 단위 테스트 ────────────────────────────────────────────────

test('buildIataFuel: 정상 입력 → 최신 행 반환', () => {
  const rows = [
    { as_of: '2026-06-07', price_usd_bbl: 141.64, fuel_wow_pct: -11.4, span_label: 'weekly', source: SOURCE_ATTRIBUTION },
    { as_of: '2026-05-31', price_usd_bbl: 159.50, fuel_wow_pct: 2.1, span_label: 'weekly', source: SOURCE_ATTRIBUTION },
  ];
  const r = buildIataFuel(rows);
  assert.ok(r);
  assert.equal(r.price_usd_bbl, 141.64);
  assert.equal(r.fuel_wow_pct, -11.4);
  assert.equal(r.span_label, 'weekly');
  assert.equal(r.as_of, '2026-06-07');
});

test('buildIataFuel: 최신 행 선택(정렬)', () => {
  const rows = [
    { as_of: '2026-05-31', price_usd_bbl: 155.0, fuel_wow_pct: 1.0, span_label: 'weekly' },
    { as_of: '2026-06-07', price_usd_bbl: 141.64, fuel_wow_pct: -11.4, span_label: 'weekly' },
  ];
  const r = buildIataFuel(rows);
  assert.equal(r.as_of, '2026-06-07');
  assert.equal(r.price_usd_bbl, 141.64);
});

test('buildIataFuel: price null 행 제외', () => {
  const rows = [
    { as_of: '2026-06-07', price_usd_bbl: null, fuel_wow_pct: -5.0, span_label: 'weekly' },
    { as_of: '2026-05-31', price_usd_bbl: 155.0, fuel_wow_pct: 1.0, span_label: 'weekly' },
  ];
  const r = buildIataFuel(rows);
  assert.equal(r.price_usd_bbl, 155.0);
});

test('buildIataFuel: 빈 rows → null', () => {
  assert.equal(buildIataFuel([]), null);
});

test('buildIataFuel: fuel_wow_pct null인 행도 price는 반환', () => {
  const rows = [{ as_of: '2026-06-07', price_usd_bbl: 141.64, fuel_wow_pct: null, span_label: 'weekly' }];
  const r = buildIataFuel(rows);
  assert.ok(r);
  assert.equal(r.price_usd_bbl, 141.64);
  assert.equal(r.fuel_wow_pct, null);
});
