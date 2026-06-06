'use strict';
// T0-6: 발표 캘린더. watch_points.due 자동 채움의 기반.
// 발표 요일/일자는 추정 하드코딩 금지 — 확인된 것만 값으로, 미확인은 null + 주석.
// cadence: 'weekly'(weekday 0=일..6=토) | 'monthly'(day_of_month) | 'biweekly'(weekday, 미구현 due)
const RELEASE_CALENDAR = [
  // 관세청 10일 잠정: 11일경(01~10)·21일경(01~20)·익월 1일경(전월 확정 직전). 정례 일정.
  { id: 'kcta_provisional', label: '관세청 10일 잠정 수출', cadence: 'monthly', day_of_month: 11, source: '관세청' },
  // 관세청 월간 확정: 15일경.
  { id: 'kcta_final', label: '관세청 월간 확정', cadence: 'monthly', day_of_month: 15, source: '관세청' },
  // KCCI: freight_indices.week_date가 전부 월요일 anchored(지수 기준일). // confirmed 2026-06-07
  //   단 이는 지수 기준일이며 실제 발표 요일(KOBC)은 미확인 → publish_unverified.
  { id: 'kcci_weekly', label: 'KCCI 주간', cadence: 'weekly', weekday: 1, publish_unverified: true, source: 'KOBC/KCCI' },
  { id: 'scfi_weekly', label: 'SCFI 주간', cadence: 'weekly', weekday: 1, publish_unverified: true, source: 'Shanghai SE' },
  // Drewry 결항: 적재 as_of 2026-06-05 = 금요일. // confirmed 2026-06-07 (drewry-headline as_of)
  { id: 'drewry_blank', label: 'Drewry 결항 트래커', cadence: 'weekly', weekday: 5, source: 'Drewry' },
  // Drewry 우회(격주)·IATA 제트유(주간): T1-1·T1-2에서 페이지 실측 시 확인 → 현재 미확인.
  { id: 'drewry_diversion', label: 'Drewry Red Sea 우회', cadence: 'biweekly', weekday: null, source: 'Drewry' },
  { id: 'iata_jet', label: 'IATA 제트유 모니터', cadence: 'weekly', weekday: null, source: 'IATA/Platts' },
];

function pad(n) { return String(n).padStart(2, '0'); }

// asof 이후(당일 제외) 다음 발표 예정일 'YYYY-MM-DD'. 미확인(weekday null)·biweekly는 null.
function nextDue(rule, asof) {
  const d = new Date(asof);
  if (rule.cadence === 'monthly') {
    let y = d.getUTCFullYear();
    let m = d.getUTCMonth();
    if (d.getUTCDate() > rule.day_of_month) { m += 1; if (m > 11) { m = 0; y += 1; } }
    return `${y}-${pad(m + 1)}-${pad(rule.day_of_month)}`;
  }
  if (rule.cadence === 'weekly' && rule.weekday != null) {
    const add = (rule.weekday - d.getUTCDay() + 7) % 7 || 7;
    return new Date(d.getTime() + add * 86400000).toISOString().slice(0, 10);
  }
  return null; // biweekly·미확인
}

function ruleById(id) {
  return RELEASE_CALENDAR.find((r) => r.id === id) || null;
}

module.exports = { RELEASE_CALENDAR, nextDue, ruleById };
