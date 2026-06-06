'use strict';
// 두 트랙 타깃 선언. 주간(주력): freight_indices 한국발 지수. 월간: KITA 항로(데이터 기반 발견).
// 각 타깃: { metric_ref, source, mode, cadence, horizon_weeks, label }

const WEEKLY_TARGETS = [
  { metric_ref: 'KCCI', source: 'freight_indices', mode: 'ocean', cadence: 'weekly', horizon_weeks: 4, label: 'KCCI 종합(한국발 해상)' },
  { metric_ref: 'SCFI', source: 'freight_indices', mode: 'ocean', cadence: 'weekly', horizon_weeks: 4, label: 'SCFI 종합' },
];

// 월간 KITA 항로는 데이터에서 발견(아래 fetchMonthlyTargets). 주요 도착지 키워드(부분일치)로 한정.
const MAJOR_DEST_KEYWORDS = ['로스앤젤레스', 'LA', '뉴욕', 'New York', '로테르담', 'Rotterdam', '함부르크', 'Hamburg'];

function horizonDate(asof, weeks) {
  const d = new Date(asof.getTime() + weeks * 7 * 86400000);
  return d.toISOString().slice(0, 10);
}

// kita_sea_rates에서 ≥3개월 데이터 + 주요 도착지인 (origin,dest) 항로를 월간 타깃으로.
async function fetchMonthlyTargets(supabase) {
  const { data } = await supabase
    .from('kita_sea_rates')
    .select('origin,dest,year_mon');
  // 키는 JSON 배열 문자열 — origin/dest 어떤 문자가 와도 (origin,dest) 쌍이 안전하게 유일.
  const byLane = new Map();
  for (const r of data || []) {
    const key = JSON.stringify([r.origin, r.dest]);
    const e = byLane.get(key) || { origin: r.origin, dest: r.dest, count: 0 };
    e.count += 1;
    byLane.set(key, e);
  }
  const targets = [];
  for (const { origin, dest, count } of byLane.values()) {
    if (count < 3) continue;
    if (!MAJOR_DEST_KEYWORDS.some((k) => dest.includes(k))) continue;
    targets.push({
      metric_ref: `kita_sea_rates:${origin}-${dest}`,
      source: 'kita_sea_rates', origin, dest,
      mode: 'ocean', cadence: 'monthly', horizon_weeks: 4,
      label: `${origin}→${dest}`,
    });
  }
  return targets;
}

module.exports = { WEEKLY_TARGETS, MAJOR_DEST_KEYWORDS, horizonDate, fetchMonthlyTargets };
