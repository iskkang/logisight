'use strict';
// ctx + prose → forecasts 행(module='climate'). 순수 함수.
// 입력은 event_route_impacts(트랙 교차 검증된 event→route via passage).
// 자동발행 게이트: 코드 가드 통과 + 비-CRITICAL + 귀속 명확 = published. 그 외 = draft(자동 보류).
// 검수 인력 부재 → 형식 검수 무의미. narrate.js 환각/가짜정밀 가드를 발행 게이트로 승격.
// (forecasts.status는 draft/published/resolved만 허용 → '보류'는 draft로 표현, auto_held 플래그로 구분.)

const EDITOR_PLACEHOLDER = '[AI 초안 · 에디터 검수 필요 — 본문 작성]';
const SEV_KO = { r: '경보(red)', a: '주의(orange)' };
const GATE_VERSION = 'climate-gate-v1';

function addDays(d, n) {
  const x = new Date(d.getTime() + n * 86400000);
  return x.toISOString().slice(0, 10);
}

// CRITICAL = 영향 큰 등급(보수적 보류 대상): 태풍 Typhoon~Super Typhoon(cyclone 'r') ·
// GDACS red · Meteoalarm Extreme · NWS extreme — 모두 severity='r'.
function isCritical(event) { return event.severity === 'r'; }

// 발행 판단. publish=false면 자동 보류(draft) + reason 기록.
function publishDecision(ctx, prose) {
  if (prose.needs_editor) return { publish: false, reason: 'guard_fail' };          // 가드 검증 실패(환각·인과·트랙초과 등)
  if (!ctx.viaPassage || !ctx.viaPassage.id || !ctx.route || !ctx.route.id) return { publish: false, reason: 'no_attribution' }; // 귀속 불명
  if (isCritical(ctx.event)) return { publish: false, reason: 'critical' };          // 영향 큰 건 보수적 보류(사람 옵션)
  return { publish: true, reason: null };
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
  const { publish, reason } = publishDecision(ctx, prose);
  const statement = needsEditor
    ? EDITOR_PLACEHOLDER
    : `[기상 리스크 변화]\n${prose.weather}\n\n[영향]\n${prose.impact}`;
  const confidence = event.severity === 'r' && event.kind === 'cyclone' ? 'medium' : 'low';
  const baseFlag = trackSummary.hasTrack ? '예보트랙 시각 미제공(경로 방향만)' : '단일좌표(트랙 없음)';
  const gateFlags = publish ? ['auto_published'] : ['auto_held', `hold:${reason}`];
  const viaName = (viaPassage && viaPassage.name_ko) || '관문';
  return {
    module: 'climate',
    // 연결 키(route_id·event_id·via_passage_id) + dedup 키.
    metric_ref: `climate:${route.id}:${event.id}:${(viaPassage && viaPassage.id) || 'none'}`,
    statement,
    impact_note: needsEditor ? null : `[권장 행동] ${prose.action}`,
    horizon_date: addDays(asof, 3), // valid_at(판정 기준일)
    confidence,
    confidence_reason: publish
      ? `트랙 교차판정 자동발행(${GATE_VERSION}): ${viaName} 통과로 ${route.name} 전파 — 코드 가드 통과`
      : `트랙 교차판정: ${viaName} 통과로 ${route.name} 전파 — 자동 보류(${reason}), 에디터 검수 옵션`,
    invalidation_condition: `이벤트 소멸 또는 트랙이 ${viaName} 반경 밖 이탈`,
    basis: buildBasis(ctx),
    data_quality_flags: [baseFlag, ...gateFlags, `gate:${GATE_VERSION}`],
    model_version: 'climate-v1',
    status: publish ? 'published' : 'draft',
    published_at: publish ? asof.toISOString() : null,
  };
}

module.exports = { mapClimateRow, buildBasis, isCritical, publishDecision, EDITOR_PLACEHOLDER, GATE_VERSION };
