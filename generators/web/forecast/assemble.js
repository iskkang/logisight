'use strict';
// 타깃 1개 → scoreForecast 입력 객체 조립(공통 supply/cost/demand + 타깃별 rate_series).
const { buildRateSeries } = require('./inputs/rate-series');
const { fetchBlankSailing } = require('./inputs/blank-sailing');
const { fetchFuel } = require('./inputs/fuel');
const { fetchDemand } = require('./inputs/demand');
const { regionOf, fetchRegionDemand } = require('./inputs/demand-region');
const { fetchDiversion } = require('./inputs/diversion');
const { fetchChinaFactor } = require('./inputs/china-factor');
const { seasonalityFlag } = require('./calendar');

// 한국발(부산 출발 / KCCI) 해상 타깃만 china_factor 적용 — 중국발 경유항 구조(v1.4 b-3).
function isKoreaOrigin(target) {
  return target.origin === '부산' || target.metric_ref === 'KCCI';
}
const { spreadContextEvent, fetchSpread } = require('./inputs/spread');
const { buildContextHeadlines } = require('./inputs/context-headlines');
const { horizonDate } = require('./targets');

// maritime_news 최근 14일(여러 타깃 공유).
async function fetchNews14d(supabase, asof = new Date()) {
  const since = new Date(asof.getTime() - 14 * 86400000).toISOString();
  const { data } = await supabase
    .from('maritime_news')
    .select('title,summary,source,published_at')
    .gte('published_at', since)
    .order('published_at', { ascending: false })
    .limit(60);
  return data || [];
}

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
  // 주의: kita_sea_rates.feu_chg는 절댓값(USD)이지 %가 아니다 → feu 레벨에서 실제 MoM %를 산출.
  const rows = data || [];
  const points = rows.map((r, i) => {
    const prev = rows[i + 1]; // 내림차순이므로 다음 인덱스가 한 달 이전
    const pct = prev && prev.feu ? Math.round(((r.feu - prev.feu) / prev.feu) * 1000) / 10 : null;
    return { value: r.feu, change_pct: pct, date: r.year_mon };
  });
  return buildRateSeries(points, { unit: 'USD/FEU', asof });
}

// 공통 입력(supply/cost/demand)은 타깃마다 재조회를 피하려 호출부에서 1회 만들어 주입할 수 있음.
async function assembleInput(supabase, target, { asof = new Date(), shared } = {}) {
  const rate_series = await fetchRateSeries(supabase, target, asof);
  // 존재 여부로 판정 — fetchFuel 등이 정상적으로 null(결측)을 반환해도 재조회하지 않도록(?? 금지).
  const has = (k) => shared != null && k in shared;
  let supply = has('supply') ? shared.supply : { blank_sailing: await fetchBlankSailing(supabase, asof) };
  const cost = has('cost') ? shared.cost : await fetchFuel(supabase, asof);
  let demand = has('demand') ? shared.demand : await fetchDemand(supabase, asof);
  const region = regionOf(target);

  // Red Sea 우회는 asia_europe(EU) 노선 유효 선복에만 영향(H5) → effective_capacity_chg_pct 주입.
  // 테이블 비어있으면 fetchDiversion이 null → 결측(더미 금지). shared.supply는 안 건드리고 복사.
  if (region === 'EU') {
    const div = has('diversion') ? shared.diversion : await fetchDiversion(supabase, asof);
    if (div && div.effective_capacity_chg_pct != null && supply.blank_sailing) {
      supply = {
        ...supply,
        blank_sailing: { ...supply.blank_sailing, effective_capacity_chg_pct: div.effective_capacity_chg_pct },
        diversion: div,
      };
    }
  }

  // 타깃 권역이 판별되고 관세청 잠정 권역 수출 모멘텀이 있으면 전국 모멘텀 대신 권역치 사용.
  // seasonality_flag·frontloading_flag는 권역 무관(달력·정책)이라 기존 값 유지.
  if (region) {
    // 권역 판별 시 seasonality는 권역별 구간으로 override(미주 7~10 peak 등). 모멘텀은 잠정치 있으면 교체.
    demand = { ...demand, seasonality_flag: seasonalityFlag(asof, region), region };
    const rd = await fetchRegionDemand(supabase, region, asof);
    if (rd.export_momentum_yoy_pct != null) {
      demand = { ...demand, export_momentum_yoy_pct: rd.export_momentum_yoy_pct, momentum_trend: rd.momentum_trend };
    }
  }
  const spread = shared && 'spread' in shared ? shared.spread : await fetchSpread(supabase);
  const context_events = [];
  const spreadEv = spreadContextEvent(spread);
  if (spreadEv) context_events.push(spreadEv);

  const news = shared && 'news' in shared ? shared.news : await fetchNews14d(supabase, asof);
  const context_headlines = buildContextHeadlines(news, target, region);

  // china_factor: 한국발 해상 타깃만(중국 경유항 구조). 그 외(WCI 상하이발 등)는 null.
  const china_factor = (target.mode === 'ocean' && isKoreaOrigin(target))
    ? (has('china_factor') ? shared.china_factor : await fetchChinaFactor(supabase))
    : null;

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
    china_factor,
    context_events,
    context_headlines,
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
    spread: await fetchSpread(supabase),
    news: await fetchNews14d(supabase, asof),
    diversion: await fetchDiversion(supabase, asof),
    china_factor: await fetchChinaFactor(supabase),
  };
}

module.exports = { assembleInput, buildShared, fetchRateSeries };
