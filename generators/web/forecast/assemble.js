'use strict';
// 타깃 1개 → scoreForecast 입력 객체 조립(공통 supply/cost/demand + 타깃별 rate_series).
const { buildRateSeries } = require('./inputs/rate-series');
const { fetchBlankSailing } = require('./inputs/blank-sailing');
const { fetchFuel } = require('./inputs/fuel');
const { fetchDemand } = require('./inputs/demand');
const { regionOf, fetchRegionDemand } = require('./inputs/demand-region');
const { seasonalityFlag } = require('./calendar');
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
  let demand = has('demand') ? shared.demand : await fetchDemand(supabase, asof);
  // 타깃 권역이 판별되고 관세청 잠정 권역 수출 모멘텀이 있으면 전국 모멘텀 대신 권역치 사용.
  // seasonality_flag·frontloading_flag는 권역 무관(달력·정책)이라 기존 값 유지.
  const region = regionOf(target);
  if (region) {
    // 권역 판별 시 seasonality는 권역별 구간으로 override(미주 7~10 peak 등). 모멘텀은 잠정치 있으면 교체.
    demand = { ...demand, seasonality_flag: seasonalityFlag(asof, region), region };
    const rd = await fetchRegionDemand(supabase, region, asof);
    if (rd.export_momentum_yoy_pct != null) {
      demand = { ...demand, export_momentum_yoy_pct: rd.export_momentum_yoy_pct, momentum_trend: rd.momentum_trend };
    }
  }
  const data_freshness = buildDataFreshness({ rate_series, supply, cost, demand }, asof);
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
    data_freshness,
  };
}

// 필드별 기준일·D-n(asof 기준 경과일) — 기존 조립 결과에서 파생.
function buildDataFreshness(input, asof) {
  const f = {};
  const dateAgo = (d) => new Date(asof.getTime() - d * 86400000).toISOString().slice(0, 10);
  const rs = input.rate_series;
  if (rs && rs.asof_age_days != null) f.rate_series = { d_n: rs.asof_age_days, as_of: dateAgo(rs.asof_age_days) };
  const bs = input.supply && input.supply.blank_sailing;
  if (bs && bs.signal_age_days != null) f.blank_sailing = { d_n: bs.signal_age_days, as_of: dateAgo(bs.signal_age_days) };
  if (input.cost && input.cost.fuel_obs_lag_weeks != null) {
    const dn = Math.round(input.cost.fuel_obs_lag_weeks * 7);
    f.cost = { d_n: dn, as_of: dateAgo(dn), span_days: input.cost.obs_span_days, approx: !!input.cost.approx };
  }
  if (input.demand && input.demand.export_momentum_yoy_pct != null) {
    f.demand = { source: input.demand.region ? `관세청 잠정(${input.demand.region})` : '관세청 잠정', note: '10일 잠정 수출' };
  }
  return f;
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
