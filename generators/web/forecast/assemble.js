'use strict';
// 타깃 1개 → scoreForecast 입력 객체 조립(공통 supply/cost/demand + 타깃별 rate_series).
const { buildRateSeries } = require('./inputs/rate-series');
const { fetchBlankSailing } = require('./inputs/blank-sailing');
const { fetchFuel } = require('./inputs/fuel');
const { fetchDemand } = require('./inputs/demand');
const { horizonDate } = require('./targets');

async function fetchRateSeries(supabase, target, asof) {
  if (target.source === 'freight_indices') {
    const { data } = await supabase
      .from('freight_indices')
      .select('value,change_pct,week_date')
      .eq('index_code', target.metric_ref)
      .order('week_date', { ascending: false })
      .limit(52);
    const points = (data || []).map((r) => ({ value: r.value, change_pct: r.change_pct, date: r.week_date }));
    return buildRateSeries(points, { unit: 'index', asof });
  }
  // kita_sea_rates
  const { data } = await supabase
    .from('kita_sea_rates')
    .select('feu,feu_chg,year_mon')
    .eq('origin', target.origin)
    .eq('dest', target.dest)
    .order('year_mon', { ascending: false })
    .limit(13);
  const points = (data || []).map((r) => ({ value: r.feu, change_pct: r.feu_chg, date: r.year_mon }));
  return buildRateSeries(points, { unit: 'USD/FEU', asof });
}

// 공통 입력(supply/cost/demand)은 타깃마다 재조회를 피하려 호출부에서 1회 만들어 주입할 수 있음.
async function assembleInput(supabase, target, { asof = new Date(), shared } = {}) {
  const rate_series = await fetchRateSeries(supabase, target, asof);
  // 존재 여부로 판정 — fetchFuel 등이 정상적으로 null(결측)을 반환해도 재조회하지 않도록(?? 금지).
  const has = (k) => shared != null && k in shared;
  const supply = has('supply') ? shared.supply : { blank_sailing: await fetchBlankSailing(supabase, asof) };
  const cost = has('cost') ? shared.cost : await fetchFuel(supabase, asof);
  const demand = has('demand') ? shared.demand : await fetchDemand(supabase, asof);
  return {
    metric_ref: target.metric_ref,
    label: target.label,
    mode: target.mode,
    cadence: target.cadence,
    horizon_date: horizonDate(asof, target.horizon_weeks),
    rate_series,
    supply,
    cost,
    demand,
    pricing_actions: null,
  };
}

// 공통 입력 1회 조립(여러 타깃 공유).
async function buildShared(supabase, asof = new Date()) {
  return {
    supply: { blank_sailing: await fetchBlankSailing(supabase, asof) },
    cost: await fetchFuel(supabase, asof),
    demand: await fetchDemand(supabase, asof),
  };
}

module.exports = { assembleInput, buildShared, fetchRateSeries };
