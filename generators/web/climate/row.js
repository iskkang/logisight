'use strict';
// ctx + prose → forecasts 행(module='climate'). 순수 함수.
// 기후 초안은 항상 status='draft' — 활성 이벤트 영향은 추정적이라 자동 발행하지 않고 에디터 검수 후 발행.

const EDITOR_PLACEHOLDER = '[AI 초안 · 에디터 검수 필요 — 본문 작성]';
const SEV_KO = { r: '경보(red)', a: '주의(orange)' };

function addDays(d, n) {
  const x = new Date(d.getTime() + n * 86400000);
  return x.toISOString().slice(0, 10);
}

function buildBasis(ctx) {
  const { event, nearestLabel, nearestKm, nearbyAssets = [] } = ctx;
  const b = [
    `이벤트: ${event.title} · ${SEV_KO[event.severity] || event.severity}`,
    `노선 최근접: ${nearestLabel} ${Math.round(nearestKm)}km`,
  ];
  for (const a of nearbyAssets.slice(0, 4)) {
    const rk = a.risk ? `평시 ${a.risk.score}/${a.risk.level}` : '평시 데이터 없음';
    b.push(`근접 자산: ${a.name}(${a.type}) ${Math.round(a.km)}km · ${rk}`);
  }
  return b;
}

function mapClimateRow(ctx, prose, asof = new Date()) {
  const { event, route } = ctx;
  const needsEditor = !!prose.needs_editor;
  const statement = needsEditor
    ? EDITOR_PLACEHOLDER
    : `[기상 리스크 변화]\n${prose.weather}\n\n[영향]\n${prose.impact}`;
  const confidence = event.severity === 'r' && event.kind === 'cyclone' ? 'medium' : 'low';
  return {
    module: 'climate',
    metric_ref: `climate:${route.id}:${event.id}`, // 연결 키(route_id·event id) + dedup 키
    statement,
    impact_note: needsEditor ? null : `[권장 행동] ${prose.action}`,
    horizon_date: addDays(asof, 3), // valid_at(판정 기준일)
    confidence,
    confidence_reason: '활성 이벤트 근접 기반 AI 초안 — 에디터 검수 필요',
    invalidation_condition: '이벤트 소멸(피드 제거) 또는 노선 1000km 밖 이탈',
    basis: buildBasis(ctx),
    data_quality_flags: ['예보경로(track) 미보유 — 접근 방향 미산출'],
    model_version: 'climate-v1',
    status: 'draft',
    published_at: null,
  };
}

module.exports = { mapClimateRow, buildBasis, EDITOR_PLACEHOLDER };
