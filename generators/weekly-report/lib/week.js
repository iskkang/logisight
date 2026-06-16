// generators/weekly-report/lib/week.js
'use strict';
// ISO 8601 주차 + 보고기간(해당 주의 월~일). 입력 Date는 UTC 기준으로 다룬다.

function atUTCMidnight(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

// ISO: 월요일=0..일요일=6
function isoDow(d) { return (d.getUTCDay() + 6) % 7; }

function isoWeek(date) {
  const d = atUTCMidnight(date);
  // 목요일로 이동해 ISO 연도/주차 결정
  d.setUTCDate(d.getUTCDate() - isoDow(d) + 3);
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  firstThursday.setUTCDate(firstThursday.getUTCDate() - isoDow(firstThursday) + 3);
  const week = 1 + Math.round((d - firstThursday) / (7 * 86400000));
  const year = d.getUTCFullYear();
  return { year, week, id: `${year}-W${String(week).padStart(2, '0')}` };
}

function reportingPeriod(date) {
  const d = atUTCMidnight(date);
  const monday = new Date(d);
  monday.setUTCDate(d.getUTCDate() - isoDow(d));
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  const mm = (x) => String(x.getUTCMonth() + 1).padStart(2, '0');
  const dd = (x) => String(x.getUTCDate()).padStart(2, '0');
  const iso = (x) => `${x.getUTCFullYear()}-${mm(x)}-${dd(x)}`;
  return {
    start: `${mm(monday)}/${dd(monday)}`,
    end: `${mm(sunday)}/${dd(sunday)}`,
    startISO: iso(monday),
    endISO: iso(sunday),
  };
}

module.exports = { isoWeek, reportingPeriod };
