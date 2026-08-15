'use strict';
// 이상치 가드
// 전월 대비 |변동률| >= 150%면 담당자 오입력으로 보고 그 값을 버린다(null).
// 프론트 /rates의 "이상치 · 검증 필요" 플래그(±150%)와 동일 기준 — 적재 단계에서 원천 차단.
// 순수 함수: 입력 rate 객체를 제자리(in-place) 보정하고, 보정 내역 로그를 반환한다.
//
// ■ 예전에는 전월값으로 바꿔치기했다 ★
// carryForwardOutliers 라는 이름 그대로, 의심스러운 값을 직전 accepted 월값으로 덮어쓰고
// 변동분 필드를 0으로 만들었다. 그 행은 kita_sea_rates·kita_air_rates 에 그대로 적재됐고,
// 어느 행이 실측이고 어느 행이 만들어진 값인지 DB 어디에도 표시가 없었다. 리포트의 KITA
// 표는 그걸 공시운임으로 실었다. 보정 내역은 GitHub Actions 로그에만 남았다.
//
// 「이 값은 못 믿겠다」와 「이번 달은 지난달과 같았다」는 다른 말이다. 뒤쪽은 데이터에
// 없는 주장이고, 전월 대비 0% 라는 가짜 관측까지 하나 더 만들어낸다.
//
// 그래서 지금은 버린다. null 은 "모른다"고 말하는 것이고, 표에는 「—」로 나간다.
// 판정 기준(±150%)은 손대지 않았다 —— 무엇을 의심할지가 아니라 의심한 값을 어떻게 다룰지가
// 문제였다. 진짜 급등이 150%를 넘어 잘려나가는 경우는 이 임계값의 원래 성질이고,
// 그 논의는 별개다.

const OUTLIER_THRESHOLD_PCT = 150;

function isOutlier(prev, cur, threshold) {
  if (prev == null || cur == null || prev === 0) return false;
  return (Math.abs(cur - prev) / Math.abs(prev)) * 100 >= threshold;
}

// rates: [{ yearMon, <fields>, <chgFields> }]
// fields: 검사·보정할 값 필드(예: ['feu','teu']). chgOf: 값필드→변동분필드 매핑(같이 null 로).
// threshold: 기본 150.
function dropOutliers(rates, fields, chgOf, threshold) {
  const t = threshold == null ? OUTLIER_THRESHOLD_PCT : threshold;
  const sorted = [...(rates || [])].sort((a, b) => String(a.yearMon).localeCompare(String(b.yearMon)));
  const lastGood = {};
  const corrections = [];
  for (const row of sorted) {
    for (const f of fields) {
      const cur = row[f];
      const prev = lastGood[f];
      if (isOutlier(prev, cur, t)) {
        corrections.push({ yearMon: row.yearMon, field: f, dropped: cur, comparedTo: prev });
        row[f] = null;
        const cf = chgOf && chgOf[f];
        // 값이 없으면 변동분도 없다. 0 을 남기면 "변화 없었다"는 관측이 되어버린다.
        if (cf && cf in row) row[cf] = null;
      }
      // 버린 값은 기준선이 되지 못한다 —— 다음 달은 마지막으로 인정된 값과 비교한다.
      if (row[f] != null) lastGood[f] = row[f];
    }
  }
  return corrections;
}

module.exports = { dropOutliers, OUTLIER_THRESHOLD_PCT };
