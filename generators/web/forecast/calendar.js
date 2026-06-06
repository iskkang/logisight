'use strict';
// 권역별 성수기 플래그(외부 데이터 불필요, 상수). v1.3 enum: peak_approaching | peak | off | none.
// 노선·권역별 성수기 구간이 다르므로 region을 받아 분기한다(미주 연말 성수기 선적 7~10월 등, H10 정합).
// 12월은 춘절(설)前 선행 부킹으로 미주 외 권역은 peak_approaching(한국발 공장 가동중단 대비).

// region → { peak:[월], peak_approaching:[월], off:[월] } (그 외 월 = none)
const SEASON_WINDOWS = {
  미주: { peak: [7, 8, 9, 10], peak_approaching: [5, 6], off: [11, 12] }, // 미주 연말 성수기 선적
  EU: { peak: [8, 9, 10], peak_approaching: [6, 7, 12], off: [11] }, // 가을 성수기 + 12월 선행
  동남아: { peak: [8, 9, 10], peak_approaching: [6, 7, 12], off: [11] },
};
const DEFAULT_WINDOW = { peak: [8, 9, 10], peak_approaching: [6, 7, 12], off: [11] }; // 권역 불명(종합 지수)

function seasonalityFlag(date, region) {
  const m = date.getUTCMonth() + 1; // 1..12
  const w = SEASON_WINDOWS[region] || DEFAULT_WINDOW;
  if (w.peak.includes(m)) return 'peak';
  if (w.peak_approaching.includes(m)) return 'peak_approaching';
  if (w.off.includes(m)) return 'off';
  return 'none';
}

module.exports = { seasonalityFlag, SEASON_WINDOWS, DEFAULT_WINDOW };
