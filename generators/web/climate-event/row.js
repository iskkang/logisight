'use strict';
// 이벤트→물류 영향 forecasts 행. 자동발행 게이트 = narrate 가드 통과 + 자산/노선 귀속.
const MODEL_VERSION = 'climate-event-v1';
const GATE_VERSION = 'climate-event-gate-v1';
const EDITOR_PLACEHOLDER = '[AI 초안 · 에디터 검수 필요 — 본문 작성]';
const SEV_KO = { r: '경보(red)', a: '주의(orange)' };

// 본문을 감싸는 머리말·라벨도 화면에 그대로 나온다. LLM 산문만 일본어로 바꾸고
// 이쪽을 두면 일본판에 '[기상 리스크 변화]'가 남는다 — 실제로 그렇게 나왔다.
const TEXT = {
  ko: {
    header: { earthquake: '[지진 상황]', tsunami: '[쓰나미 상황]', default: '[기상 리스크 변화]' },
    impact: '[영향]',
    action: '[권장 행동]',
    invalidation: '이벤트 해제·경보 하향 시 무효',
  },
  // 마커는 일본판 화면(LogisightClimate의 fcSections·fcAction)이 그대로 잘라내는 문자열이다.
  // 여기서 바꾸면 화면에서 라벨이 본문에 섞여 나온다. 임의로 고치지 말 것.
  ja: {
    header: { earthquake: '[地震の状況]', tsunami: '[津波の状況]', default: '[気象リスクの変化]' },
    impact: '[影響]',
    action: '[推奨アクション]',
    invalidation: 'イベント解除・警報の引き下げで無効',
  },
};

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

/**
 * @param {'ko'|'ja'} [lang='ko'] statement·impact_note의 언어. prose가 이미 그 언어여야 한다.
 */
function mapEventRow(ctx, prose, asof, lang = 'ko') {
  const T = TEXT[lang] || TEXT.ko;
  const { event } = ctx;
  const { publish, reason } = publishDecisionEvent(ctx, prose);
  const head = T.header[event.kind] || T.header.default;
  const statement = prose.needs_editor
    ? EDITOR_PLACEHOLDER
    : `${head}\n${prose.weather}\n\n${T.impact}\n${prose.impact}`;
  const confidence = event.severity === 'r' && event.kind === 'cyclone' ? 'medium' : 'low';
  const gateFlags = publish ? ['auto_published'] : ['auto_held', `hold:${reason}`];
  return {
    module: 'climate',
    lang,
    metric_ref: `climate:event:${event.id}`,
    statement,
    impact_note: prose.needs_editor ? null : `${T.action} ${prose.action}`,
    horizon_date: addDays(asof, 3),
    confidence,
    // confidence_reason·basis는 운영 로그다. 화면에 나오지 않으므로 한국어로 통일한다.
    confidence_reason: publish ? `자산 근접 자동발행(${GATE_VERSION}): ${(ctx.linkedAssets[0] || {}).name || (ctx.linkedRoutes[0] || {}).name} 근접 — 코드 가드 통과` : `보류: ${reason}`,
    invalidation_condition: T.invalidation,
    basis: buildEventBasis(ctx),
    data_quality_flags: ['climate_event', ...gateFlags, `gate:${GATE_VERSION}`],
    model_version: MODEL_VERSION,
    status: publish ? 'published' : 'draft',
    published_at: publish ? asof.toISOString() : null,
  };
}

module.exports = { mapEventRow, publishDecisionEvent, buildEventBasis, MODEL_VERSION, EDITOR_PLACEHOLDER };
