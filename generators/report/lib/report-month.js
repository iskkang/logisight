'use strict';
// 월간 리포트 대상 월 계산 — 직전 완료월 타깃, 발행월 데이터 배제용 월말일 계산.
// 모든 계산 UTC 기준(로컬 타임존 영향 배제).

function prevCompletedMonth(today) {
  const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  d.setUTCDate(0); // 현재월 1일의 하루 전 = 직전월 말일
  return d.toISOString().slice(0, 7);
}

function monthEndISO(month) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m, 0)); // m(1-indexed)을 0-indexed로 넘기면 다음달, day 0 = 그 달 말일
  return d.toISOString().slice(0, 10);
}

function resolveMonth(argv, today) {
  const arg = argv.find(a => a.startsWith('--month='));
  return arg ? arg.split('=')[1] : prevCompletedMonth(today);
}

module.exports = { prevCompletedMonth, monthEndISO, resolveMonth };
