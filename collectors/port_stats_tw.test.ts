import test from 'node:test';
import assert from 'node:assert/strict';

import { annualYears, parseMonthlyRows, verifyAgainstAnnual } from './port_stats_tw';

const HEADER = ['Year', 'Grand Total', 'Import Container', 'Export Container'];
const M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** 12개월 × per = 연간이 되도록 만든 가짜 응답. */
function fixture(per: number, extraMonths: number): string[][] {
  const rows: string[][] = [HEADER, ['2024', String(per * 12), '0', '0'], ['2025', String(per * 12), '0', '0']];
  for (const m of M) rows.push([m, String(per), String(per / 2), String(per / 2)]);
  for (let i = 0; i < extraMonths; i++) rows.push([M[i], String(per), String(per / 2), String(per / 2)]);
  return rows;
}

test('annualYears: 4자리 연도 행만 골라 오름차순', () => {
  assert.deepEqual(annualYears(fixture(100, 0)), [2024, 2025]);
});

// ★ 이 소스의 핵심 함정. 월 행에 연도가 없고 두 해가 이어붙어 있다.
test('앞 12개월은 직전 완전연도, 나머지는 당해연도로 가른다', () => {
  const rows = parseMonthlyRows(fixture(100, 6));
  assert.equal(rows.length, 18);
  assert.deepEqual(
    rows.slice(0, 12).map((r) => r.year),
    Array(12).fill(2025),
  );
  assert.deepEqual(
    rows.slice(12).map((r) => `${r.year}-${r.month}`),
    ['2026-1', '2026-2', '2026-3', '2026-4', '2026-5', '2026-6'],
  );
});

test('Jan 이 두 번 나와도 서로 덮어쓰지 않는다', () => {
  const rows = parseMonthlyRows(fixture(100, 1));
  const jans = rows.filter((r) => r.month === 1);
  assert.deepEqual(jans.map((r) => r.year), [2025, 2026]);
});

test('당해연도 누적이 아직 없으면 12개월 전부 직전 완전연도', () => {
  const rows = parseMonthlyRows(fixture(100, 0));
  assert.deepEqual([...new Set(rows.map((r) => r.year))], [2025]);
});

test('소수점 값을 정수 파싱하지 않는다 (1,120,704.25 → 1120704)', () => {
  const rows: string[][] = [HEADER, ['2025', '13546117', '0', '0'],
    ...M.map((m) => [m, '1128843.0833', '0', '0']),
    ['Jun', '1120704.25', '562944.5', '557759.75']];
  const parsed = parseMonthlyRows(rows);
  const jun2026 = parsed.find((r) => r.year === 2026 && r.month === 6);
  assert.equal(jun2026?.teu, 1120704);
  assert.equal(jun2026?.import_teu, 562945);
  assert.equal(jun2026?.export_teu, 557760);
});

// ★ 연도 배정이 틀리면 여기서 걸린다 —— 조용히 어긋난 데이터를 적재하지 않는다.
test('verifyAgainstAnnual: 12개월 합계가 연간 값과 맞으면 통과', () => {
  const rows = fixture(100, 6);
  assert.doesNotThrow(() => verifyAgainstAnnual(rows, parseMonthlyRows(rows)));
});

test('verifyAgainstAnnual: 합계가 어긋나면 던진다', () => {
  const rows = fixture(100, 6);
  rows[2] = ['2025', '999999', '0', '0']; // 연간 값만 어긋나게
  assert.throws(() => verifyAgainstAnnual(rows, parseMonthlyRows(rows)), /연도 배정 검증 실패/);
});

test('country·port_code 는 TW / TW_ALL 로 고정', () => {
  const r = parseMonthlyRows(fixture(100, 1))[0];
  assert.equal(r.country, 'TW');
  assert.equal(r.port_code, 'TW_ALL');
});
