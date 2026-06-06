'use strict';
// T0-1: 관세청 10일 잠정 수출(trade_statistics stat_type='provisional_exp')을 권역으로 매핑 →
// export_momentum_yoy_pct · momentum_trend. 확정치(item/country)는 검증·백업용.
// 권역: 미주·EU·동남아는 잠정 수출 대상국 보유 / CIS·중동은 대상국 없음 → 결측(정직).

const REGION_COUNTRIES = {
  미주: ['US'],
  EU: ['EU'],
  동남아: ['VN', 'SG', 'MY'],
  CIS: [], // 잠정 수출 데이터에 해당국 없음(RU는 수입 맵에만) → 결측
  중동: [], // SA는 수입 맵에만 → 결측
};

// 타깃 dest/label/metric_ref → 권역. 종합 지수 등 불명은 null.
const DEST_REGION = [
  [/함부르크|로테르담|제노바|hamburg|rotterdam|genoa|antwerp|RTM|GOA|NEU|MED|WAF|ZAF|유럽/i, 'EU'],
  [/로스앤젤레스|뉴욕|롱비치|LAX|NYC|USWC|USEC|미주|미국|시카고/i, '미주'],
  [/싱가포르|호치민|방콕|SEA|동남아/i, '동남아'],
];
function regionOf(target) {
  const hay = `${target.dest || ''} ${target.label || ''} ${target.metric_ref || ''}`;
  for (const [re, region] of DEST_REGION) if (re.test(hay)) return region;
  return null;
}

function priorYear(period) {
  // 'YYYY-MM' 또는 'YYYYMM'
  return `${Number(String(period).slice(0, 4)) - 1}${String(period).slice(4)}`;
}

// rows: provisional_exp 행 [{period, priod_dt, country_code, export_usd}].
function buildRegionDemand(rows, region, asof) {
  const countries = REGION_COUNTRIES[region] || [];
  if (!countries.length) return { export_momentum_yoy_pct: null, momentum_trend: null };
  const inRegion = (rows || []).filter((r) => countries.includes(r.country_code) && r.export_usd != null);
  if (!inRegion.length) return { export_momentum_yoy_pct: null, momentum_trend: null };

  const sums = new Map(); // 'period|priod_dt' → Σ export_usd
  for (const r of inRegion) {
    const k = `${r.period}|${r.priod_dt}`;
    sums.set(k, (sums.get(k) || 0) + Number(r.export_usd));
  }
  const PREF = ['01~31', '01~말일', '01~20', '01~10'];
  const pickDt = (p) => PREF.find((dt) => sums.has(`${p}|${dt}`));
  const periods = [...new Set(inRegion.map((r) => r.period))].sort().reverse();

  const yoyOf = (p) => {
    const dt = pickDt(p);
    if (!dt) return null;
    const cur = sums.get(`${p}|${dt}`);
    const prev = sums.get(`${priorYear(p)}|${dt}`);
    return prev != null && prev !== 0 ? Math.round(((cur - prev) / prev) * 1000) / 10 : null;
  };

  const yoy = yoyOf(periods[0]);
  const yoys = periods.slice(0, 3).map(yoyOf).filter((v) => v != null);
  let trend = null;
  if (yoys.length >= 2) {
    if (yoys[0] > yoys[yoys.length - 1] + 0.5) trend = 'accelerating';
    else if (yoys[0] < yoys[yoys.length - 1] - 0.5) trend = 'decelerating';
    else trend = 'stable';
  }
  return { export_momentum_yoy_pct: yoy, momentum_trend: trend };
}

async function fetchRegionDemand(supabase, region, asof = new Date()) {
  const countries = REGION_COUNTRIES[region] || [];
  if (!countries.length) return { export_momentum_yoy_pct: null, momentum_trend: null };
  const { data } = await supabase
    .from('trade_statistics')
    .select('period,priod_dt,country_code,export_usd')
    .eq('stat_type', 'provisional_exp')
    .in('country_code', countries);
  return buildRegionDemand(data || [], region, asof);
}

module.exports = { REGION_COUNTRIES, regionOf, buildRegionDemand, fetchRegionDemand, priorYear };
