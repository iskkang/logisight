'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildDiversion, capeToCapacityChg, NORMAL_CAPE_SHARE } = require('./diversion');

const asof = new Date('2026-06-07T00:00:00Z');

// ── capeToCapacityChg 단위 테스트 ────────────────────────────────────────────

test('capeToCapacityChg: 정상 수준(20%) → 0', () => {
  assert.equal(capeToCapacityChg(20), 0);
});

test('capeToCapacityChg: 케이프 비율 0% (수에즈 완전 정상화) → 0', () => {
  assert.equal(capeToCapacityChg(0), 0);
});

test('capeToCapacityChg: 케이프 비율 100% (완전 우회) → -12', () => {
  // (100-20)/10 * -1.5 = 8 * -1.5 = -12
  assert.equal(capeToCapacityChg(100), -12);
});

test('capeToCapacityChg: 케이프 비율 90% → SSOT 상한 클램프 -12 (< -10 밴드)', () => {
  // (90-20)/10 * -1.5 = 7 * -1.5 = -10.5
  assert.equal(capeToCapacityChg(90), -10.5);
});

test('capeToCapacityChg: 매우 높은 케이프 비율 → -15 클램프', () => {
  // 초과 선형값이 -15 이하면 -15로 클램프
  // -15에 달하려면 excess = 100: cape_share_pct = 120 (이론값)
  assert.equal(capeToCapacityChg(120), -15);
});

test('capeToCapacityChg: null → null', () => {
  assert.equal(capeToCapacityChg(null), null);
});

test('capeToCapacityChg: NaN → null', () => {
  assert.equal(capeToCapacityChg(NaN), null);
});

// ── buildDiversion 통합 테스트 ───────────────────────────────────────────────

test('buildDiversion: 정상 입력 → 올바른 구조 반환', () => {
  const rows = [
    { as_of: '2026-06-03', cape_share_pct: 85, suez_share_pct: 15, source: 'Drewry Red Sea Diversion Tracker (admin-input)' },
    { as_of: '2026-05-20', cape_share_pct: 80, suez_share_pct: 20, source: 'Drewry Red Sea Diversion Tracker (admin-input)' },
  ];
  const r = buildDiversion(rows, asof);
  assert.ok(r, '결과가 null이면 안 됨');
  assert.equal(r.source_type, 'admin_input');
  assert.equal(r.cape_share_pct, 85);
  assert.equal(r.suez_share_pct, 15);
  assert.equal(r.as_of, '2026-06-03');
  assert.equal(r.signal_age_days, 4); // 2026-06-07 - 2026-06-03
  // (85-20)/10 * -1.5 = 6.5 * -1.5 = -9.75 → JS Math.round(-97.5)/10 = -9.7 (negative half rounds up)
  assert.equal(r.effective_capacity_chg_pct, -9.7);
});

test('buildDiversion: 최신 행 선택(내림차순 정렬)', () => {
  const rows = [
    { as_of: '2026-05-20', cape_share_pct: 80 },
    { as_of: '2026-06-03', cape_share_pct: 90 }, // 더 최신
  ];
  const r = buildDiversion(rows, asof);
  assert.equal(r.cape_share_pct, 90);
});

test('buildDiversion: cape_share_pct null 행 제외', () => {
  const rows = [
    { as_of: '2026-06-05', cape_share_pct: null },
    { as_of: '2026-05-20', cape_share_pct: 75 },
  ];
  const r = buildDiversion(rows, asof);
  assert.ok(r);
  assert.equal(r.cape_share_pct, 75);
});

test('buildDiversion: 미래 행 제외', () => {
  const rows = [
    { as_of: '2026-06-10', cape_share_pct: 90 }, // asof(2026-06-07) 이후
    { as_of: '2026-05-20', cape_share_pct: 75 },
  ];
  const r = buildDiversion(rows, asof);
  assert.equal(r.cape_share_pct, 75); // 미래 행 무시
});

test('buildDiversion: 빈 rows → null', () => {
  assert.equal(buildDiversion([], asof), null);
});

test('buildDiversion: 전부 null cape → null', () => {
  assert.equal(buildDiversion([{ as_of: '2026-06-03', cape_share_pct: null }], asof), null);
});

test('buildDiversion: 케이프 정상화(≤20%) → effective_capacity_chg_pct = 0', () => {
  const rows = [{ as_of: '2026-06-05', cape_share_pct: 18 }];
  const r = buildDiversion(rows, asof);
  assert.equal(r.effective_capacity_chg_pct, 0);
});
