'use strict';
// verdict + prose + input → forecasts 행. 순수 함수.

const { flagsFor, strengthFor } = require('./flags');

const EDITOR_PLACEHOLDER = '[AI 초안 · 에디터 검수 필요 — 본문 작성]';

// basis는 근거 목록으로 화면에 그대로 나온다. 산문만 일본어로 바꾸고 여기를 두면
// 일본판 카드에 '결항률'·'수출 YoY'가 남는다.
const BASIS = {
  ko: { latest: '최신', change: '변화율', blank: '결항률', export: '수출 YoY' },
  ja: { latest: '直近', change: '変化率', blank: '欠航率', export: '輸出 YoY' },
};

function buildBasis(input, lang = 'ko') {
  const T = BASIS[lang] || BASIS.ko;
  const b = [];
  const rs = input.rate_series;
  if (rs) b.push(`${input.metric_ref} ${T.latest} ${rs.latest} (${T.change} ${rs.mom_pct ?? 'n/a'}%)`);
  const bsig = input.supply && input.supply.blank_sailing;
  if (bsig && bsig.ratio_pct != null) b.push(`${T.blank} ${bsig.ratio_pct}% (${bsig.direction})`);
  if (input.cost && input.cost.fuel_mom_pct != null) b.push(`VLSFO MoM ${input.cost.fuel_mom_pct}%`);
  if (input.demand && input.demand.export_momentum_yoy_pct != null) b.push(`${T.export} ${input.demand.export_momentum_yoy_pct}%`);
  return b;
}

/**
 * @param {'ko'|'ja'} [lang='ko'] statement·impact_note·basis의 언어. prose가 이미 그 언어여야 한다.
 */
function mapVerdictToRow(input, verdict, prose, asof = new Date(), lang = 'ko') {
  // 확신 전망(본문 작성됨)은 자동 발행. needs_editor(본문 미작성)는 draft로 검수 큐에 남김.
  const publish = !prose.needs_editor;
  return {
    module: 'rates',
    lang,
    watch_points: [], // 발표일 달력(watch_points)은 생성 중단 — stale 표시 문제. 채점엔 영향 없음.
    metric_ref: input.metric_ref,
    cadence: input.cadence,
    horizon_date: input.horizon_date,
    direction: verdict.direction,
    // 강도 라벨도 설정의 한국어다. 옮기지 않으면 카드에 '상승 우세'가 남는다.
    strength: strengthFor(verdict.strength, lang),
    composite_score: verdict.composite_score,
    range_low_pct: verdict.range_low_pct,
    range_high_pct: verdict.range_high_pct,
    expected_range_pct: verdict.expected_range_pct,
    confidence: verdict.confidence,
    factor_scores: verdict.factor_scores,
    // 플래그는 화면에도 나온다. 옮기지 않으면 일본판 카드에 '결측 — 가중치 재분배'가 남는다.
    data_quality_flags: flagsFor(verdict.data_quality_flags, lang),
    model_version: verdict.model_version,
    metric_value_at_publish: input.rate_series ? input.rate_series.latest : null,
    basis: buildBasis(input, lang),
    statement: prose.needs_editor ? EDITOR_PLACEHOLDER : prose.statement,
    impact_note: prose.needs_editor ? null : prose.impact_note,
    status: publish ? 'published' : 'draft',
    published_at: publish ? asof.toISOString() : null,
  };
}

module.exports = { mapVerdictToRow, buildBasis, EDITOR_PLACEHOLDER, BASIS };
