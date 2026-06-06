'use strict';
// 마이그레이션 적용 여부 사전 검증 — generate 진입부 가드.
// 누락 컬럼·테이블을 만나면 조용히 스킵하지 않고 명시적으로 실패시킨다.
// 검증 대상: forecasts 스코어링/watch_points 컬럼(20260607000000·010000),
//          red_sea_diversion·iata_jet_fuel_weekly 테이블(020000·030000).

const REQUIRED = {
  forecasts: [
    'cadence', 'direction', 'strength', 'expected_range_pct',
    'range_low_pct', 'range_high_pct', 'composite_score', 'factor_scores',
    'confidence_reason', 'data_quality_flags', 'model_version',
    'metric_value_at_publish', 'realized_pct', 'watch_points',
  ],
  red_sea_diversion: ['*'],
  iata_jet_fuel_weekly: ['*'],
};

// supabase에 각 테이블의 필수 컬럼을 limit(1)로 조회 — 컬럼/테이블 누락 시 PostgREST가 에러를 반환한다.
async function assertSchema(supabase) {
  const missing = [];
  for (const [table, cols] of Object.entries(REQUIRED)) {
    const { error } = await supabase.from(table).select(cols.join(',')).limit(1);
    if (error) missing.push(`${table} — ${error.message}`);
  }
  if (missing.length) {
    throw new Error(
      '마이그레이션 미적용으로 generate 중단(조용한 스킵 금지):\n'
      + missing.map((m) => '  ✗ ' + m).join('\n')
      + '\n→ supabase/migrations 20260607000000·010000·020000·030000 적용 후 재실행.'
    );
  }
}

module.exports = { assertSchema, REQUIRED };
