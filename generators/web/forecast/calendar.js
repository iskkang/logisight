'use strict';
// 달력 기반 성수기 플래그(외부 데이터 불필요, 상수). Decision 3 cheap win.
// 근거: 미주/유럽 해상 성수기 8~10월 → 6~7월 선행 부킹; 춘절 전(12월) 공장 가동중단 대비 프론트로딩.
// CNY는 매년 변동(1월말~2월) — v1은 12월을 선행 근사로 둔다(분기 보정 시 정교화).
function seasonalityFlag(date) {
  const m = date.getUTCMonth() + 1; // 1..12
  if (m === 6 || m === 7) return 'peak_approaching';
  if (m >= 8 && m <= 10) return 'peak';
  if (m === 12) return 'peak_approaching';
  return 'none';
}

module.exports = { seasonalityFlag };
