'use strict';
// ctx + prose → forecasts 행(module='climate'). 순수 함수.
// 입력은 event_route_impacts(트랙 교차 검증된 event→route via passage). 항상 status='draft'(에디터 검수 후 발행).

const EDITOR_PLACEHOLDER = '[AI 초안 · 에디터 검수 필요 — 본문 작성]';
const SEV_KO = { r: '경보(red)', a: '주의(orange)' };

function addDays(d, n) {
  const x = new Date(d.getTime() + n * 86400000);
  return x.toISOString().slice(0, 10);
}

function buildBasis(ctx) {
  const { event, route, viaPassage, viaMinKm, sharedRoutes = [], trackSummary = {} } = ctx;
  const b = [
    `이벤트: ${event.title} · ${SEV_KO[event.severity] || event.severity}`,
    `걸린 관문: ${viaPassage.name_ko} · ${Math.round(viaMinKm)}km · ${trackSummary.hasTrack ? '예보트랙 교차' : '단일좌표 근접'}`,
    `전파 노선: ${route.name}(${route.id}) — ${viaPassage.name_ko} 통과`,
  ];
  if (sharedRoutes.length) b.push(`관문 공유 노선: ${sharedRoutes.map((r) => r.name).join(', ')}`);
  for (const a of (ctx.nearbyAssets || []).slice(0, 3)) {
    const rk = a.risk ? `평시 ${a.risk.score}/${a.risk.level}` : '평시 데이터 없음';
    b.push(`근접 자산: ${a.name}(${a.type}) ${Math.round(a.km)}km · ${rk}`);
  }
  return b;
}

function mapClimateRow(ctx, prose, asof = new Date()) {
  const { event, route, viaPassage, trackSummary = {} } = ctx;
  const needsEditor = !!prose.needs_editor;
  const statement = needsEditor
    ? EDITOR_PLACEHOLDER
    : `[기상 리스크 변화]\n${prose.weather}\n\n[영향]\n${prose.impact}`;
  const confidence = event.severity === 'r' && event.kind === 'cyclone' ? 'medium' : 'low';
  return {
    module: 'climate',
    // 연결 키(route_id·event_id·via_passage_id) + dedup 키.
    metric_ref: `climate:${route.id}:${event.id}:${viaPassage.id}`,
    statement,
    impact_note: needsEditor ? null : `[권장 행동] ${prose.action}`,
    horizon_date: addDays(asof, 3), // valid_at(판정 기준일)
    confidence,
    confidence_reason: `트랙 교차판정: ${viaPassage.name_ko} 통과로 ${route.name} 전파 — AI 초안, 에디터 검수`,
    invalidation_condition: `이벤트 소멸 또는 트랙이 ${viaPassage.name_ko} 반경 밖 이탈`,
    basis: buildBasis(ctx),
    data_quality_flags: [trackSummary.hasTrack ? '예보트랙 시각 미제공(경로 방향만)' : '단일좌표(트랙 없음)'],
    model_version: 'climate-v1',
    status: 'draft',
    published_at: null,
  };
}

module.exports = { mapClimateRow, buildBasis, EDITOR_PLACEHOLDER };
