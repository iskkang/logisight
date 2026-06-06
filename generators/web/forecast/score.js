'use strict';
const {
  SUPPLY_SIGNAL_MAX_AGE_DAYS, WEIGHTS, THRESHOLDS, STALE_DAYS, MODEL_VERSION,
} = require('./config/forecast-model');

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

// A. 운임 모멘텀 (-2..+2). rate_series: {trend_3p, percentile_52w, mom_pct}
function scoreMomentum(rs) {
  if (!rs || rs.trend_3p == null) return null;
  const p = rs.percentile_52w;
  const m = rs.mom_pct;
  let s;
  if (rs.trend_3p === 'up_3' && p != null && p >= 70) s = 2;
  else if (rs.trend_3p === 'up_2' || (m != null && m > 3)) s = 1;
  else if (rs.trend_3p === 'down_3' && p != null && p <= 30) s = -2;
  else if (rs.trend_3p === 'down_2' || (m != null && m < -3)) s = -1;
  else s = 0; // mixed 또는 |mom|<=1 포함
  // 평균회귀 보정
  if (p != null && p >= 90) s -= 0.5;
  else if (p != null && p <= 10) s += 0.5;
  return clamp(s, -2, 2);
}

// B. 공급 조정 (-2..+2). blank_sailing 구조체.
function scoreSupply(bs) {
  if (!bs || bs.source_type == null || bs.source_type === 'none') return null;
  if (bs.signal_age_days != null && bs.signal_age_days > SUPPLY_SIGNAL_MAX_AGE_DAYS) return null;
  if (bs.source_type === 'tracker_quoted') {
    const r = bs.ratio_pct;
    const cap = bs.effective_capacity_chg_pct;
    if ((r != null && r >= 15 && bs.direction === 'expanding') || (cap != null && cap <= -10)) return 2;
    if ((r != null && r >= 7) || bs.direction === 'expanding' || (cap != null && cap <= -3)) return 1;
    if (cap != null && cap >= 10) return -2;
    if (bs.direction === 'easing' && cap != null && cap > 0) return -1;
    return 0;
  }
  if (bs.source_type === 'news_derived') {
    const n = bs.independent_sources || 1;
    if (bs.direction === 'expanding' && bs.magnitude_class === 'major' && n >= 2) return 2;
    if (bs.direction === 'expanding') return 1;
    if (bs.direction === 'easing' && bs.magnitude_class === 'major' && n >= 2) return -2;
    if (bs.direction === 'easing') return -1;
    return 0; // stable | mixed
  }
  return null;
}

// C. 수요 (-2..+2).
// 우선순위 주의: seasonality_flag=peak_approaching는 문서 규칙상 크기 무관 +1(m 가드 없음)이라
// 보합(±2%) 가드보다 먼저 평가한다. 그 외 ±2% 이내는 보합 → 0(문서 "0: 보합 ±2% 이내, stable").
function scoreDemand(d) {
  if (!d || d.export_momentum_yoy_pct == null) return null;
  const m = d.export_momentum_yoy_pct;
  if ((m >= 5 && d.momentum_trend === 'accelerating') || (d.frontloading_flag && m > 0)) return 2;
  if (d.seasonality_flag === 'peak_approaching') return 1;
  if (Math.abs(m) <= 2) return 0;
  if (m > 0 && (d.momentum_trend === 'stable' || d.momentum_trend === 'accelerating')) return 1;
  if (m <= -5 && d.momentum_trend === 'decelerating') return -2;
  if (d.momentum_trend === 'decelerating' || m < 0) return -1;
  return 0;
}

// D. 비용(유가) (-2..+2). demandScore로 전가 실패 규칙 적용.
function scoreCost(c, demandScore) {
  if (!c || c.fuel_mom_pct == null) return null;
  const f = c.fuel_mom_pct;
  let s;
  if (f >= 10) s = 2;
  else if (f >= 5) s = 1;
  else if (f > -5) s = 0;
  else if (f > -10) s = -1;
  else s = -2;
  if (demandScore != null && demandScore <= -1) s = s * 0.5; // 전가 실패 → ±1이면 ±0.5(소수 점수 허용)
  return s;
}

// E. 가격 행동 (-2..+2). announcements 배열 존재 여부로 결측/정의 구분.
function scorePricing(p) {
  if (!p || !Array.isArray(p.announcements)) return null;
  const cuts = p.announcements.filter((a) => /인하|cut/i.test(a.type || ''));
  if (cuts.length > 1) return -2;
  if (cuts.length === 1) return -1;
  if (p.announcements.length === 0) return 0;
  if (p.historical_success_rate != null && p.historical_success_rate >= 0.6) return 2;
  return 1; // 공지 존재, 관철률 불명
}

function round2(v) { return Math.round(v * 100) / 100; }

// 결측 팩터(null)는 제외하고 가중치를 재분배(renormalize)한 가중합.
function composite(scores, weights) {
  let active = 0;
  for (const f of Object.keys(weights)) if (scores[f] != null) active += weights[f];
  if (active === 0) return null;
  let sum = 0;
  for (const f of Object.keys(weights)) {
    if (scores[f] == null) continue;
    sum += scores[f] * (weights[f] / active);
  }
  return round2(sum);
}

// composite → THRESHOLDS 버킷. 경계는 문서 그대로(flat = 개구간).
function classify(c) {
  if (c >= 0.8) return THRESHOLDS.upHigh;
  if (c >= 0.4) return THRESHOLDS.upLean;
  if (c > -0.4) return THRESHOLDS.flat;
  if (c > -0.8) return THRESHOLDS.downLean;
  return THRESHOLDS.downHigh;
}

function confidence(scores, weights) {
  const factors = Object.keys(weights);
  const present = factors.filter((f) => scores[f] != null);
  const missing = factors.length - present.length;
  const nonZero = present.map((f) => scores[f]).filter((v) => v !== 0);
  const pos = nonZero.filter((v) => v > 0).length;
  const neg = nonZero.filter((v) => v < 0).length;

  if (missing >= 2) return 'low';
  // 충돌 규칙 5: 3개 이상 부호 충돌
  if (pos >= 1 && neg >= 1 && pos + neg >= 3) return 'medium';
  // 취약한 상승: 공급 우위(+) & 수요 약화(-)
  if (scores.supply != null && scores.supply >= 1 && scores.demand != null && scores.demand <= -1) return 'medium';
  if (missing === 1) return 'medium';
  // 'high'는 5개 팩터 전부 최신(missing===0)이고 부호가 일치할 때만. 1개라도 결측이면 위에서 medium 확정.
  // (문서 confidence 규칙의 "4개 이상 최신"과 "일부 결측→중간"이 겹쳐 보수적으로 해석.)
  if (present.length >= 4 && (pos === 0 || neg === 0)) return 'high';
  return 'medium';
}

function fmtRange(range) {
  if (!range) return null;
  const [lo, hi] = range;
  const sLo = lo > 0 ? `+${lo}` : `${lo}`;
  return `${sLo}~${hi}`;
}

// input: { mode, cadence, rate_series, supply:{blank_sailing}, demand, cost, pricing_actions }
function scoreForecast(input) {
  const rs = input.rate_series;
  if (!rs || rs.latest == null) return { abstain: true, reason: 'rate_series 결측' };
  const staleMax = STALE_DAYS[input.cadence] || STALE_DAYS.weekly;
  if (rs.asof_age_days != null && rs.asof_age_days > staleMax) {
    return { abstain: true, reason: `기준일 과도(>${staleMax}d)` };
  }

  const weights = WEIGHTS[input.mode] || WEIGHTS.ocean;
  const scores = {
    momentum: scoreMomentum(rs),
    supply: scoreSupply(input.supply && input.supply.blank_sailing),
    demand: scoreDemand(input.demand),
    pricing: scorePricing(input.pricing_actions),
    cost: null,
  };
  scores.cost = scoreCost(input.cost, scores.demand);

  if (scores.supply == null && scores.demand == null) {
    return { abstain: true, reason: 'supply·demand 동시 결측' };
  }

  const comp = composite(scores, weights);
  if (comp == null) return { abstain: true, reason: '활성 팩터 없음' };

  const cls = classify(comp);
  const conf = confidence(scores, weights);
  return {
    abstain: false,
    mode: input.mode,
    cadence: input.cadence,
    direction: cls.direction,
    strength: cls.strength,
    composite_score: comp,
    range_low_pct: cls.range ? cls.range[0] : null,
    range_high_pct: cls.range ? cls.range[1] : null,
    expected_range_pct: fmtRange(cls.range),
    confidence: conf,
    factor_scores: Object.keys(weights).map((f) => ({
      factor: f, score: scores[f], weight: weights[f], missing: scores[f] == null,
    })),
    data_quality_flags: Object.keys(weights)
      .filter((f) => scores[f] == null)
      .map((f) => `${f}: 결측 — 가중치 재분배`),
    model_version: MODEL_VERSION,
  };
}

module.exports = {
  scoreMomentum, scoreSupply, scoreDemand, scoreCost, scorePricing, clamp,
  composite, classify, confidence, round2, scoreForecast, fmtRange,
};
