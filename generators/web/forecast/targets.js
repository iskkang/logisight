'use strict';
// 두 트랙 타깃 선언. 주간(주력): freight_indices 한국발 지수. 월간: KITA 항로(데이터 기반 발견).
// 각 타깃: { metric_ref, source, mode, cadence, horizon_weeks, label }

const WEEKLY_TARGETS = [
  { metric_ref: 'KCCI', source: 'freight_indices', mode: 'ocean', cadence: 'weekly', horizon_weeks: 4, label: 'KCCI 종합(한국발 해상)' },
  { metric_ref: 'SCFI', source: 'freight_indices', mode: 'ocean', cadence: 'weekly', horizon_weeks: 4, label: 'SCFI 종합' },
  { metric_ref: 'WCI', source: 'freight_indices', mode: 'ocean', cadence: 'weekly', horizon_weeks: 4, label: 'WCI 종합' },
  { metric_ref: 'WCI_SHA_LAX', source: 'freight_indices', mode: 'ocean', cadence: 'weekly', horizon_weeks: 4, label: 'WCI 상하이→LA' },
  { metric_ref: 'WCI_SHA_RTM', source: 'freight_indices', mode: 'ocean', cadence: 'weekly', horizon_weeks: 4, label: 'WCI 상하이→로테르담' },
];

/**
 * 일본판 주간 타깃.
 *
 * KCCI는 한국발 지수이고 KITA 월간 항로는 전부 부산발이다. 일본 화주에게
 * '부산→뉴욕' 전망은 읽을 이유가 없다 — 번역해서 낼 대상이 아니라 아예
 * 대상이 아니다. 발표 기관이 세계 공통인 지수만 남긴다.
 *
 * SCFI·WCI는 상하이발이지만 아시아–구주/미주 기간항로의 기준이라 일본 화주도
 * 그대로 쓴다. 일본판 월간 리포트가 세계 스팟 축으로 쓰는 계열과 같다.
 */
const WEEKLY_TARGETS_JA = [
  { metric_ref: 'SCFI', source: 'freight_indices', mode: 'ocean', cadence: 'weekly', horizon_weeks: 4, label: 'SCFI 総合' },
  { metric_ref: 'WCI', source: 'freight_indices', mode: 'ocean', cadence: 'weekly', horizon_weeks: 4, label: 'WCI 総合' },
  { metric_ref: 'WCI_SHA_LAX', source: 'freight_indices', mode: 'ocean', cadence: 'weekly', horizon_weeks: 4, label: 'WCI 上海→ロサンゼルス' },
  { metric_ref: 'WCI_SHA_RTM', source: 'freight_indices', mode: 'ocean', cadence: 'weekly', horizon_weeks: 4, label: 'WCI 上海→ロッテルダム' },
];

const WEEKLY_BY_LANG = { ko: WEEKLY_TARGETS, ja: WEEKLY_TARGETS_JA };

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

module.exports = {
  WEEKLY_TARGETS, WEEKLY_TARGETS_JA, WEEKLY_BY_LANG,
  MAJOR_DEST_KEYWORDS, horizonDate, fetchMonthlyTargets,
};
