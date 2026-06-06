'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildDiversion, diversionToCapacityChg } = require('./diversion');

const asof = new Date('2026-06-07T00:00:00Z');

test('diversionToCapacityChg: 완전 우회 Δ+100pt → ≈ -12% (H5 밴드 중앙)', () => {
  assert.equal(diversionToCapacityChg(100), -12);
});
test('diversionToCapacityChg: Δ 음수(우회 완화) → 양수(회복), 클램프 [-15,+15]', () => {
  assert.equal(diversionToCapacityChg(-50), 6);
  assert.equal(diversionToCapacityChg(200), -15); // 클램프
  assert.equal(diversionToCapacityChg(null), null);
});

test('buildDiversion: 최근 2건 Δcape → effective_capacity_chg_pct', () => {
  const rows = [
    { as_of: '2026-06-03', cape_share_pct: 80 },
    { as_of: '2026-05-20', cape_share_pct: 70 }, // Δ +10pt
  ];
  const d = buildDiversion(rows, asof);
  assert.equal(d.delta_cape_pt, 10);
  assert.equal(d.effective_capacity_chg_pct, -1.2); // -0.12 × 10
  assert.equal(d.source_type, 'admin_input');
});

test('buildDiversion: 1건뿐 → null (Δ 산출 불가, 결측)', () => {
  assert.equal(buildDiversion([{ as_of: '2026-06-03', cape_share_pct: 80 }], asof), null);
});
test('buildDiversion: 빈 테이블 → null (더미 금지)', () => {
  assert.equal(buildDiversion([], asof), null);
});
test('buildDiversion: 미래 행 제외 → 유효 1건 → null', () => {
  const rows = [
    { as_of: '2026-09-01', cape_share_pct: 90 }, // 미래
    { as_of: '2026-06-03', cape_share_pct: 80 },
  ];
  assert.equal(buildDiversion(rows, asof), null);
});
