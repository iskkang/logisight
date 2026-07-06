'use strict';
// 주간 지수 시리즈의 비교 기준 행 선택 — 리포트 전체 공용 (단일 계산 원칙).
// 규칙: 기준일(최신주 − daysBack) "이전(at-or-before)" 중 가장 가까운 공표주.
//   시리즈에 수집 누락 주가 있어도 더 최근 주로 당겨 비교(과소평가)하지 않는다.
// 01 총론 표(index-factsheet)·02 해운 표(ocean-indices)·역내(intra-asia)가 함께 사용해
// 같은 지표가 섹션마다 다른 증감률로 표기되는 정합성 문제를 차단.

function weekOf(row) { return row.week ?? row.week_date; }

// series: 최신순 정렬된 [{week|week_date, ...}] / latestWeek: 'YYYY-MM-DD' / daysBack: 7=전주, 28=전월
function prevAtOrBefore(series, latestWeek, daysBack) {
  const cutoff = new Date(new Date(latestWeek + 'T00:00:00Z').getTime() - daysBack * 86400000)
    .toISOString().slice(0, 10);
  for (const row of series) {
    const w = weekOf(row);
    if (w && w <= cutoff) return row;   // 최신순이므로 첫 매치 = cutoff 이전 최근접
  }
  return null;
}

module.exports = { prevAtOrBefore };
