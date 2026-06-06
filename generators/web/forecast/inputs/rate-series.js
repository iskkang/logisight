'use strict';
// rate_series 조립 — {value, change_pct, date} 포인트 배열(최신순)에서 파생.
// date는 'YYYY-MM' | 'YYYY-MM-DD' | Date 허용.

// 월간(YYYYMM·YYYY-MM)은 관측이 해당 월 전체를 대표 → 월말 기준.
// 월초로 두면 d_n(경과일)이 ~1개월 과대평가돼 월간 타깃이 D-60 경계에서 잘못 abstain될 수 있다.
function monthEnd(y, mo /* 1..12 */) {
  return new Date(Date.UTC(y, mo, 0)); // 해당 월 말일
}
function toDate(d) {
  if (d instanceof Date) return d;
  const s = String(d).trim();
  if (/^\d{6}$/.test(s)) return monthEnd(Number(s.slice(0, 4)), Number(s.slice(4, 6))); // 'YYYYMM'(KITA)
  if (/^\d{4}-\d{2}$/.test(s)) return monthEnd(Number(s.slice(0, 4)), Number(s.slice(5, 7))); // 'YYYY-MM'
  return new Date(`${s}T00:00:00Z`); // 'YYYY-MM-DD'(주간·일간)
}

// 최근 3개 포인트의 change_pct 부호로 추세 분류.
function trend3p(points) {
  const last3 = points.slice(0, 3).map((p) => p.change_pct).filter((v) => v != null);
  if (last3.length < 3) return 'mixed';
  const pos = last3.filter((v) => v > 0).length;
  const neg = last3.filter((v) => v < 0).length;
  if (pos === 3) return 'up_3';
  if (neg === 3) return 'down_3';
  if (pos === 2) return 'up_2';
  if (neg === 2) return 'down_2';
  return 'mixed';
}

// latest 값의 백분위(<= latest 비율). 정수 반올림.
function percentile(latest, values) {
  const vals = values.filter((v) => v != null);
  if (!vals.length) return null;
  const le = vals.filter((v) => v <= latest).length;
  return Math.round((le / vals.length) * 100);
}

function buildRateSeries(points, { unit, asof }) {
  if (!points || !points.length) return null;
  const sorted = [...points].sort((a, b) => toDate(b.date) - toDate(a.date));
  const latest = sorted[0];
  const values = sorted.map((p) => p.value).filter((v) => v != null);
  const pct = percentile(latest.value, values);
  // vs_normal_band: 표시/투명성용 파생(스코어러는 percentile_52w만 사용).
  let band = 'within';
  if (pct != null && pct >= 70) band = 'above';
  else if (pct != null && pct <= 30) band = 'below';
  const ageDays = Math.round((asof - toDate(latest.date)) / 86400000);
  return {
    latest: latest.value,
    unit,
    mom_pct: latest.change_pct,
    trend_3p: trend3p(sorted),
    percentile_52w: pct,
    vs_normal_band: band,
    asof_age_days: ageDays,
  };
}

module.exports = { trend3p, percentile, buildRateSeries, toDate };
