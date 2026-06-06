'use strict';
// demand 조립 — trade_statistics 국가합산 YoY + 달력 성수기 + 정책기반 프론트로딩.
const { seasonalityFlag } = require('../calendar');

function priorYear(period) {
  const [y, m] = period.split('-');
  return `${Number(y) - 1}-${m}`;
}

// totals: [{period:'YYYY-MM', total}] (정렬 무관). 최신 period의 YoY와 최근 3개월 추세.
function exportMomentum(totals) {
  if (!totals || !totals.length) return { yoy_pct: null, trend: null };
  // 'YYYY-MM'(zero-padded)만 사용 — 연간 'YYYY' 등은 제외(문자열 정렬·priorYear 가정 보호).
  const map = new Map(totals.filter((t) => /^\d{4}-\d{2}$/.test(t.period)).map((t) => [t.period, t.total]));
  const periods = [...map.keys()].sort().reverse(); // 최신순(zero-padded 가정)
  const latest = periods[0];
  const yoyOf = (p) => {
    const cur = map.get(p);
    const prev = map.get(priorYear(p));
    if (cur == null || prev == null || prev === 0) return null;
    return Math.round(((cur - prev) / prev) * 1000) / 10;
  };
  const yoy = yoyOf(latest);
  // 추세: 최근 3개월 YoY 비교
  const yoys = periods.slice(0, 3).map(yoyOf).filter((v) => v != null);
  let trend = null;
  if (yoys.length >= 2) {
    if (yoys[0] > yoys[yoys.length - 1] + 0.5) trend = 'accelerating';
    else if (yoys[0] < yoys[yoys.length - 1] - 0.5) trend = 'decelerating';
    else trend = 'stable';
  }
  return { yoy_pct: yoy, trend };
}

function frontloadingFlag(policies, asof) {
  if (!policies || !policies.length) return false;
  // 날짜 문자열(YYYY-MM-DD)로 비교 — asof 시각/타임존에 따라 당일 정책이 플립되지 않도록.
  const asofStr = asof.toISOString().slice(0, 10);
  const horizonStr = new Date(asof.getTime() + 60 * 86400000).toISOString().slice(0, 10);
  return policies.some((p) => {
    if (!p.effective_date) return false;
    const eff = String(p.effective_date).slice(0, 10);
    return eff >= asofStr && eff <= horizonStr;
  });
}

function buildDemand({ totals, policies, asof }) {
  const mom = exportMomentum(totals);
  return {
    export_momentum_yoy_pct: mom.yoy_pct,
    momentum_trend: mom.trend,
    seasonality_flag: seasonalityFlag(asof),
    frontloading_flag: frontloadingFlag(policies, asof),
  };
}

// trade_statistics에서 국가합산 월별 export_usd 총액(YoY 위해 24개월) → buildDemand.
async function fetchDemand(supabase, asof = new Date()) {
  const since = `${asof.getUTCFullYear() - 2}-01`;
  const { data: rows } = await supabase
    .from('trade_statistics')
    .select('period,export_usd')
    .eq('stat_type', 'country')
    .gte('period', since);
  const sums = new Map();
  for (const r of rows || []) {
    if (r.export_usd == null) continue;
    sums.set(r.period, (sums.get(r.period) || 0) + Number(r.export_usd));
  }
  const totals = [...sums.entries()].map(([period, total]) => ({ period, total }));
  const { data: policies } = await supabase
    .from('policies')
    .select('effective_date')
    .gte('effective_date', asof.toISOString().slice(0, 10));
  return buildDemand({ totals, policies: policies || [], asof });
}

module.exports = { exportMomentum, frontloadingFlag, buildDemand, fetchDemand };
