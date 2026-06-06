'use strict';
// 예측(direction + range) vs 실측 변화율(realizedPct) → 'hit' | 'partial' | 'miss' | null.
// 문서 규칙: 범위 안=적중, 방향만 맞음=부분, 방향 틀림=비적중. flat은 ±1% 이내=적중.
function classifyOutcome(forecast, realizedPct) {
  if (realizedPct == null || Number.isNaN(realizedPct)) return null;
  const { direction, range_low_pct: lo, range_high_pct: hi } = forecast;
  if (direction === 'flat') return Math.abs(realizedPct) <= 1 ? 'hit' : 'miss';
  if (direction === 'up') {
    if (lo != null && hi != null && realizedPct >= lo && realizedPct <= hi) return 'hit';
    return realizedPct > 0 ? 'partial' : 'miss';
  }
  if (direction === 'down') {
    if (lo != null && hi != null && realizedPct >= lo && realizedPct <= hi) return 'hit';
    return realizedPct < 0 ? 'partial' : 'miss';
  }
  return null;
}

module.exports = { classifyOutcome };
