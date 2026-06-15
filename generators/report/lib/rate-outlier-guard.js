'use strict';
// 이상치 carry-forward 가드
// 전월 대비 |변동률| >= 150%면 담당자 오입력으로 보고 직전(누적 accepted) 월값을 그대로 사용한다.
// 프론트 /rates의 "이상치 · 검증 필요" 플래그(±150%)와 동일 기준 — 적재 단계에서 원천 차단.
// 순수 함수: 입력 rate 객체를 제자리(in-place) 보정하고, 보정 내역 로그를 반환한다.

const OUTLIER_THRESHOLD_PCT = 150;

function isOutlier(prev, cur, threshold) {
  if (prev == null || cur == null || prev === 0) return false;
  return (Math.abs(cur - prev) / Math.abs(prev)) * 100 >= threshold;
}

// rates: [{ yearMon, <fields>, <chgFields> }]
// fields: 검사·보정할 값 필드(예: ['feu','teu']). chgOf: 값필드→변동분필드 매핑(보정 시 0으로). threshold: 기본 150.
function carryForwardOutliers(rates, fields, chgOf, threshold) {
  const t = threshold == null ? OUTLIER_THRESHOLD_PCT : threshold;
  const sorted = [...(rates || [])].sort((a, b) => String(a.yearMon).localeCompare(String(b.yearMon)));
  const lastGood = {};
  const corrections = [];
  for (const row of sorted) {
    for (const f of fields) {
      const cur = row[f];
      const prev = lastGood[f];
      if (isOutlier(prev, cur, t)) {
        corrections.push({ yearMon: row.yearMon, field: f, from: cur, to: prev });
        row[f] = prev;
        const cf = chgOf && chgOf[f];
        if (cf && cf in row) row[cf] = 0;
      }
      if (row[f] != null) lastGood[f] = row[f];
    }
  }
  return corrections;
}

module.exports = { carryForwardOutliers, OUTLIER_THRESHOLD_PCT };
