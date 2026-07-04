'use strict';
// 월간 리포트 월 계산 — 라벨(발행) 월과 데이터(직전 완료) 월 분리.
//   라벨 월  = 발행 시점의 현재 월(예 7월) → 디렉터리·파일명·제목.
//   데이터 월 = 라벨의 직전월(예 6월) → 지수·뉴스 상한 = 그 달 말일(발행월 데이터 배제).
// 모든 계산 UTC 기준(로컬 타임존 영향 배제).

function monthEndISO(month) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m, 0)); // m(1-indexed)을 0-indexed로 넘기면 다음달, day 0 = 그 달 말일
  return d.toISOString().slice(0, 10);
}

function prevMonthOf(month) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1, 1)); // 라벨월 1일
  d.setUTCDate(0);                            // 하루 전 = 직전월 말일
  return d.toISOString().slice(0, 7);
}

function resolveMonth(argv, today) {
  const arg = argv.find(a => a.startsWith('--month='));
  return arg ? arg.split('=')[1] : today.toISOString().slice(0, 7);
}

module.exports = { monthEndISO, prevMonthOf, resolveMonth };
