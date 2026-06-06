'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { assertSchema, REQUIRED } = require('./preflight');

// 모든 테이블 조회가 성공(error:null) → 통과.
function okSupabase() {
  return { from: () => ({ select: () => ({ limit: async () => ({ data: [], error: null }) }) }) };
}
// 특정 테이블만 에러 반환.
function failingSupabase(badTable, message) {
  return {
    from: (table) => ({
      select: () => ({
        limit: async () => (table === badTable
          ? ({ data: null, error: { message } })
          : ({ data: [], error: null })),
      }),
    }),
  };
}

test('assertSchema: 모든 스키마 존재 → 통과', async () => {
  await assertSchema(okSupabase()); // throw 없으면 성공
});

test('assertSchema: forecasts 컬럼 누락 → 명시적 실패', async () => {
  const sb = failingSupabase('forecasts', 'column forecasts.watch_points does not exist');
  await assert.rejects(() => assertSchema(sb), /마이그레이션 미적용.*watch_points/s);
});

test('assertSchema: 테이블 누락 → 명시적 실패', async () => {
  const sb = failingSupabase('red_sea_diversion', 'relation "red_sea_diversion" does not exist');
  await assert.rejects(() => assertSchema(sb), /red_sea_diversion/);
});

test('REQUIRED: forecasts 핵심 컬럼·신규 테이블 포함', () => {
  assert.ok(REQUIRED.forecasts.includes('watch_points'));
  assert.ok(REQUIRED.forecasts.includes('composite_score'));
  assert.ok('iata_jet_fuel_weekly' in REQUIRED);
});
