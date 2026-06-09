'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildCapeShare, buildTwoPeriods, SUEZ_BASELINE, SOURCE } = require('./portwatch-diversion');

const B = 19.8; // test baseline

test('buildCapeShare: 정상 — deviation 50% → cape 50', () => {
  const rows = Array.from({ length: 7 }, (_, i) => ({
    date: `2026-06-0${i + 1}`,
    n_container: B / 2, // 9.9
  }));
  const r = buildCapeShare(rows, B);
  assert.ok(r);
  assert.equal(r.cape_share_pct, 50);
  assert.equal(r.suez_share_pct, 50);
  assert.equal(r.source, SOURCE);
  assert.equal(r.as_of, '2026-06-07');
});

test('buildCapeShare: current >= baseline → cape 0 (우회 없음)', () => {
  const rows = [{ date: '2026-06-01', n_container: 30 }]; // > baseline
  const r = buildCapeShare(rows, B);
  assert.equal(r.cape_share_pct, 0);
  assert.equal(r.suez_share_pct, 100);
});

test('buildCapeShare: n_container = 0 → cape 100 (완전 우회)', () => {
  const rows = [{ date: '2026-06-01', n_container: 0 }];
  const r = buildCapeShare(rows, B);
  assert.equal(r.cape_share_pct, 100);
  assert.equal(r.suez_share_pct, 0);
});

test('buildCapeShare: n_container null 행 제외', () => {
  const rows = [
    { date: '2026-06-02', n_container: null },
    { date: '2026-06-01', n_container: 10 },
  ];
  const r = buildCapeShare(rows, B);
  assert.ok(r);
  assert.equal(r.current_avg, 10);
});

test('buildCapeShare: 빈 rows → null', () => {
  assert.equal(buildCapeShare([], B), null);
});

test('buildCapeShare: as_of은 최신 날짜', () => {
  const rows = [
    { date: '2026-06-01', n_container: 10 },
    { date: '2026-06-03', n_container: 8 },
    { date: '2026-06-02', n_container: 9 },
  ];
  const r = buildCapeShare(rows, B);
  assert.equal(r.as_of, '2026-06-03');
});

test('buildCapeShare: 8일 중 최신 7일만 평균', () => {
  const rows = [
    ...Array.from({ length: 7 }, (_, i) => ({
      date: `2026-06-0${i + 2}`, // Jun 2-8
      n_container: 0,
    })),
    { date: '2026-06-01', n_container: B * 10 }, // oldest — excluded
  ];
  const r = buildCapeShare(rows, B);
  assert.equal(r.cape_share_pct, 100); // oldest excluded → avg stays 0
});

test('buildCapeShare: baseline 기본값 = SUEZ_BASELINE', () => {
  const rows = [{ date: '2026-06-01', n_container: SUEZ_BASELINE / 2 }];
  const r = buildCapeShare(rows);
  assert.equal(r.cape_share_pct, 50);
  assert.equal(r.baseline, SUEZ_BASELINE);
});

test('SUEZ_BASELINE: 양수 숫자', () => {
  assert.equal(typeof SUEZ_BASELINE, 'number');
  assert.ok(SUEZ_BASELINE > 0);
});

// ── buildTwoPeriods ────────────────────────────────────────────────────────────

test('buildTwoPeriods: 14일 데이터 → 두 기간 반환', () => {
  const rows = Array.from({ length: 14 }, (_, i) => ({
    date: `2026-06-${String(i + 1).padStart(2, '0')}`,
    n_container: i < 7 ? 5 : 15, // 최신 7일: avg 5, 이전 7일: avg 15
  }));
  const result = buildTwoPeriods(rows, B);
  assert.equal(result.length, 2);
  assert.equal(result[0].as_of, '2026-06-14'); // 최신
  assert.equal(result[1].as_of, '2026-06-07'); // 이전
});

test('buildTwoPeriods: 7일 미만 데이터 → 한 기간만', () => {
  const rows = Array.from({ length: 5 }, (_, i) => ({
    date: `2026-06-0${i + 1}`,
    n_container: 10,
  }));
  const result = buildTwoPeriods(rows, B);
  assert.equal(result.length, 1);
});

test('buildTwoPeriods: 빈 rows → null', () => {
  assert.equal(buildTwoPeriods([], B), null);
});
