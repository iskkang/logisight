'use strict';
// verdict + prose + input → forecasts 행(status='draft'). 순수 함수.
const { buildWatchPoints } = require('./watch-points');

const EDITOR_PLACEHOLDER = '[AI 초안 · 에디터 검수 필요 — 본문 작성]';

function buildBasis(input) {
  const b = [];
  const rs = input.rate_series;
  if (rs) b.push(`${input.metric_ref} 최신 ${rs.latest} (변화율 ${rs.mom_pct ?? 'n/a'}%)`);
  const bsig = input.supply && input.supply.blank_sailing;
  if (bsig && bsig.ratio_pct != null) b.push(`결항률 ${bsig.ratio_pct}% (${bsig.direction})`);
  if (input.cost && input.cost.fuel_mom_pct != null) b.push(`VLSFO MoM ${input.cost.fuel_mom_pct}%`);
  if (input.demand && input.demand.export_momentum_yoy_pct != null) b.push(`수출 YoY ${input.demand.export_momentum_yoy_pct}%`);
  return b;
}

function mapVerdictToRow(input, verdict, prose, asof = new Date()) {
  // 확신 전망(본문 작성됨)은 자동 발행. needs_editor(본문 미작성)는 draft로 검수 큐에 남김.
  const publish = !prose.needs_editor;
  return {
    module: 'rates',
    watch_points: buildWatchPoints(input, asof),
    metric_ref: input.metric_ref,
    cadence: input.cadence,
    horizon_date: input.horizon_date,
    direction: verdict.direction,
    strength: verdict.strength,
    composite_score: verdict.composite_score,
    range_low_pct: verdict.range_low_pct,
    range_high_pct: verdict.range_high_pct,
    expected_range_pct: verdict.expected_range_pct,
    confidence: verdict.confidence,
    factor_scores: verdict.factor_scores,
    data_quality_flags: verdict.data_quality_flags,
    model_version: verdict.model_version,
    metric_value_at_publish: input.rate_series ? input.rate_series.latest : null,
    basis: buildBasis(input),
    statement: prose.needs_editor ? EDITOR_PLACEHOLDER : prose.statement,
    impact_note: prose.needs_editor ? null : prose.impact_note,
    status: publish ? 'published' : 'draft',
    published_at: publish ? asof.toISOString() : null,
  };
}

module.exports = { mapVerdictToRow, buildBasis, EDITOR_PLACEHOLDER };
