'use strict';
// ctx + prose → forecasts 행(module='climate'). 순수 함수.
// 입력은 event_route_impacts(트랙 교차 검증된 event→route via passage).
// 전량 자동발행 게이트: 코드 가드 통과 + 귀속 명확 = published(전 등급, 태풍 포함).
// 검수 인력 부재 → 형식 검수 무의미. narrate.js 환각/가짜정밀/오귀속 가드가 유일한 발행 게이트.
// 가드 실패·귀속 근거 없음만 자동 보류. (forecasts.status는 draft/published/resolved만 허용 →
//  '보류'는 draft로 표현, auto_held 플래그로 구분 — 기존 검수 큐에 그대로 노출.)

const EDITOR_PLACEHOLDER = '[AI 초안 · 에디터 검수 필요 — 본문 작성]';
const SEV_KO = { r: '경보(red)', a: '주의(orange)' };
const GATE_VERSION = 'climate-gate-v2';

// 본문의 섹션 마커. 화면이 이 문자열을 그대로 잘라내 본문·영향·권장행동으로 나눈다
// (일본판은 LogisightClimate의 fcSections·fcAction·fcVia). 임의로 바꾸지 말 것.
// 발행 본문 1번 섹션 헤더 — 지진·쓰나미는 기상이 아니므로 종류별 헤더. 그 외는 기상.
const TEXT = {
  ko: {
    header: { earthquake: '[지진 상황]', tsunami: '[쓰나미 상황]', default: '[기상 리스크 변화]' },
    impact: '[영향]',
    action: '[권장 행동]',
    via: '걸린 관문:',
    passageFallback: '관문',
  },
  ja: {
    header: { earthquake: '[地震の状況]', tsunami: '[津波の状況]', default: '[気象リスクの変化]' },
    impact: '[影響]',
    action: '[推奨アクション]',
    via: '[関門]',
    passageFallback: '関門',
  },
};

/** 관문명. 일본어가 없으면 한국어로 두는 편이 빈칸보다 낫다. */
const passageName = (p, lang) => (p && (lang === 'ja' ? p.name_ja || p.name_ko : p.name_ko)) || null;

function addDays(d, n) {
  const x = new Date(d.getTime() + n * 86400000);
  return x.toISOString().slice(0, 10);
}

// 발행 판단. publish=false면 자동 보류(draft) + reason 기록. CRITICAL 특례 없음(전량 자동).
function publishDecision(ctx, prose) {
  if (prose.needs_editor) return { publish: false, reason: 'guard_fail' };          // 가드 검증 실패(환각·가짜정밀·인과 단정·트랙초과 등)
  if (!ctx.viaPassage || !ctx.viaPassage.id || !ctx.route || !ctx.route.id) return { publish: false, reason: 'no_attribution' }; // 귀속 불명
  return { publish: true, reason: null };
}

function buildBasis(ctx, lang = 'ko') {
  const T = TEXT[lang] || TEXT.ko;
  const { event, route, viaPassage, viaMinKm, sharedRoutes = [], trackSummary = {} } = ctx;
  const via = passageName(viaPassage, lang);
  const b = [
    `이벤트: ${event.title} · ${SEV_KO[event.severity] || event.severity}`,
    // 화면(fcVia)이 이 줄의 접두사로 관문명을 뽑는다.
    `${T.via} ${via} · ${Math.round(viaMinKm)}km · ${trackSummary.hasTrack ? '예보트랙 교차' : '단일좌표 근접'}`,
    `전파 노선: ${route.name}(${route.id}) — ${via} 통과`,
  ];
  if (sharedRoutes.length) b.push(`관문 공유 노선: ${sharedRoutes.map((r) => r.name).join(', ')}`);
  for (const a of (ctx.nearbyAssets || []).slice(0, 3)) {
    const rk = a.risk ? `평시 ${a.risk.score}/${a.risk.level}` : '평시 데이터 없음';
    b.push(`근접 자산: ${a.name}(${a.type}) ${Math.round(a.km)}km · ${rk}`);
  }
  return b;
}

/**
 * @param {'ko'|'ja'} [lang='ko'] statement·impact_note의 언어. prose가 이미 그 언어여야 한다.
 */
function mapClimateRow(ctx, prose, asof = new Date(), lang = 'ko') {
  const T = TEXT[lang] || TEXT.ko;
  const { event, route, viaPassage, trackSummary = {} } = ctx;
  const needsEditor = !!prose.needs_editor;
  const { publish, reason } = publishDecision(ctx, prose);
  const statement = needsEditor
    ? EDITOR_PLACEHOLDER
    : `${T.header[event.kind] || T.header.default}\n${prose.weather}\n\n${T.impact}\n${prose.impact}`;
  const confidence = event.severity === 'r' && event.kind === 'cyclone' ? 'medium' : 'low';
  const baseFlag = trackSummary.hasTrack ? '예보트랙 시각 미제공(경로 방향만)' : '단일좌표(트랙 없음)';
  const gateFlags = publish ? ['auto_published'] : ['auto_held', `hold:${reason}`];
  const viaName = passageName(viaPassage, lang) || T.passageFallback;
  return {
    module: 'climate',
    lang,
    // 연결 키(route_id·event_id·via_passage_id) + dedup 키.
    metric_ref: `climate:${route.id}:${event.id}:${(viaPassage && viaPassage.id) || 'none'}`,
    statement,
    impact_note: needsEditor ? null : `${T.action} ${prose.action}`,
    horizon_date: addDays(asof, 3), // valid_at(판정 기준일)
    confidence,
    confidence_reason: publish
      ? `트랙 교차판정 자동발행(${GATE_VERSION}): ${viaName} 통과로 ${route.name} 전파 — 코드 가드 통과`
      : `트랙 교차판정: ${viaName} 통과로 ${route.name} 전파 — 자동 보류(${reason}), 에디터 검수 옵션`,
    invalidation_condition: `이벤트 소멸 또는 트랙이 ${viaName} 반경 밖 이탈`,
    basis: buildBasis(ctx, lang),
    data_quality_flags: [baseFlag, ...gateFlags, `gate:${GATE_VERSION}`],
    model_version: 'climate-v1',
    status: publish ? 'published' : 'draft',
    published_at: publish ? asof.toISOString() : null,
  };
}

module.exports = { mapClimateRow, buildBasis, publishDecision, passageName, EDITOR_PLACEHOLDER, GATE_VERSION, TEXT };
