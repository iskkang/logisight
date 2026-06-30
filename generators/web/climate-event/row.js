'use strict';
// 이벤트→물류 영향 forecasts 행. 자동발행 게이트 = narrate 가드 통과 + 자산/노선 귀속.
const MODEL_VERSION = 'climate-event-v1';
const GATE_VERSION = 'climate-event-gate-v1';
const EDITOR_PLACEHOLDER = '[AI 초안 · 에디터 검수 필요 — 본문 작성]';
const SEV_KO = { r: '경보(red)', a: '주의(orange)' };
const SITUATION_HEADER = { earthquake: '[지진 상황]', tsunami: '[쓰나미 상황]' };

function addDays(d, n) { return new Date(d.getTime() + n * 86400000).toISOString().slice(0, 10); }

function publishDecisionEvent(ctx, prose) {
  if (prose.needs_editor) return { publish: false, reason: 'guard_fail' };
  if (!(ctx.linkedAssets && ctx.linkedAssets.length) && !(ctx.linkedRoutes && ctx.linkedRoutes.length)) return { publish: false, reason: 'no_attribution' };
  return { publish: true, reason: null };
}

function buildEventBasis(ctx) {
  const { event, linkedAssets = [], linkedRoutes = [] } = ctx;
  const b = [`이벤트: ${event.title} · ${SEV_KO[event.severity] || event.severity}`];
  if (linkedAssets[0]) b.push(`연관 거점: ${linkedAssets[0].name}(${linkedAssets[0].type}) · ${linkedAssets[0].km}km`);
  for (const a of linkedAssets.slice(1, 3)) b.push(`연관 거점: ${a.name}(${a.type}) · ${a.km}km`);
  if (linkedRoutes.length) b.push(`연관 노선: ${linkedRoutes.map((r) => r.name).join(', ')}`);
  return b;
}

function mapEventRow(ctx, prose, asof) {
  const { event } = ctx;
  const { publish, reason } = publishDecisionEvent(ctx, prose);
  const head = SITUATION_HEADER[event.kind] || '[기상 리스크 변화]';
  const statement = prose.needs_editor
    ? EDITOR_PLACEHOLDER
    : `${head}\n${prose.weather}\n\n[영향]\n${prose.impact}`;
  const confidence = event.severity === 'r' && event.kind === 'cyclone' ? 'medium' : 'low';
  const gateFlags = publish ? ['auto_published'] : ['auto_held', `hold:${reason}`];
  return {
    module: 'climate',
    metric_ref: `climate:event:${event.id}`,
    statement,
    impact_note: prose.needs_editor ? null : `[권장 행동] ${prose.action}`,
    horizon_date: addDays(asof, 3),
    confidence,
    confidence_reason: publish ? `자산 근접 자동발행(${GATE_VERSION}): ${(ctx.linkedAssets[0] || {}).name || (ctx.linkedRoutes[0] || {}).name} 근접 — 코드 가드 통과` : `보류: ${reason}`,
    invalidation_condition: '이벤트 해제·경보 하향 시 무효',
    basis: buildEventBasis(ctx),
    data_quality_flags: ['climate_event', ...gateFlags, `gate:${GATE_VERSION}`],
    model_version: MODEL_VERSION,
    status: publish ? 'published' : 'draft',
    published_at: publish ? asof.toISOString() : null,
  };
}

module.exports = { mapEventRow, publishDecisionEvent, buildEventBasis, MODEL_VERSION, EDITOR_PLACEHOLDER };
