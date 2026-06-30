'use strict';
// 이벤트→물류 영향 AI 초안. 가드(validateClimate)·safeParse는 climate/narrate.js 재사용.
const { validateClimate, safeParse } = require('../climate/narrate');

function buildEventPrompt(ctx) {
  const { event, linkedAssets = [], linkedRoutes = [] } = ctx;
  const isSeismic = event.kind === 'earthquake' || event.kind === 'tsunami';
  const system = [
    '당신은 글로벌 물류 리스크 분석가다. 아래 "실데이터"만 사용해 한국어로 이벤트의 물류 영향 초안을 쓴다. 입력에 없는 자산·노선·수치·사실을 만들지 않는다.',
    '[중요 — 귀속 근거] 이 이벤트가 물류에 영향을 주는 이유는 "이벤트가 물류 자산(항만·내륙 거점 등)에 근접"하기 때문이다. 반드시 가장 가까운 연관 자산을 본문에 명시하라(왜 이 자산인지 = 이벤트가 근접해서).',
    '[중요 — 신호 가중] asset_risk score는 평시 기상장만 반영하며 활성 이벤트는 별개 신호다. 점수가 낮아도 활성 이벤트가 근접하면 리스크는 높을 수 있다.',
    '[내륙 거점] type=inland 자산은 항만 통관 후 철도·트럭 연결 구간이다. 영향은 "항만 통관 후 내륙 연결 지연" 관점으로 서술하라.',
    '[본문 — JSON 3필드]',
    `1) weather(${isSeismic ? '재해 상황' : '기상 리스크 변화'}): 이벤트 강도·현재 위치. ${event.track ? '예보트랙이 있으면 진행 방향만(점별 예보시각 없음 — "+N일" 시점 단정 금지).' : '점 이벤트이므로 이동 경로/시점을 지어내지 마라.'}`,
    '2) impact(영향): 연관 자산(거점)·노선의 리드타임·적체 가능성. 정량은 범위+추정만(예: "+1~3일가량 추정"), 근거 없으면 정성만. 가짜 정밀 금지.',
    '3) action(권장 행동): 화주·운영자 행동 1개.',
    '[분량] weather·impact 각 4~5문장 이내, action 1~2문장.',
    '[표현 규칙] 확률·추정 표현, 인과 단정 금지(정합/추정/상관). "확실/반드시/틀림없/분명히/~할 것이다" 금지.',
    '출력은 JSON 하나: {"weather":"...","impact":"...","action":"...","event_echo":"<이벤트명 그대로>"}.',
  ].join('\n');
  const facts = {
    기준일: ctx.asof.toISOString().slice(0, 10),
    이벤트: { 명칭: event.name, 원문_타이틀: event.title, 종류: event.kind, 심각도: event.severity === 'r' ? '경보(red)' : '주의(orange)', 현재좌표: event.lon != null ? [event.lon, event.lat] : null, 권역: event.area || null },
    예보트랙: Array.isArray(event.track) && event.track.length ? { 점수: event.track.length, 주의: '점별 예보시각 없음 — 시점 단정 금지' } : '없음(점 이벤트)',
    연관_자산: linkedAssets.map((a) => ({ 이름: a.name, 유형: a.type, 거리_km: a.km, 평시리스크: a.risk ? { score: a.risk.score, level: a.risk.level, driver: a.risk.driver } : '데이터 없음' })),
    연관_노선: linkedRoutes.map((r) => r.name),
  };
  const user = `다음 실데이터로 이벤트 물류 영향 초안을 작성하라(JSON만).\n${JSON.stringify(facts, null, 2)}`;
  return { system, user };
}

async function narrateEventImpact(callLLM, ctx, { maxRetries = 1 } = {}) {
  const prompt = buildEventPrompt(ctx);
  let last = { issues: ['미실행'] };
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const parsed = safeParse(await callLLM(prompt));
    const v = validateClimate(parsed, ctx);
    last = v;
    if (v.ok) return { weather: parsed.weather.trim(), impact: parsed.impact.trim(), action: parsed.action.trim(), needs_editor: false };
  }
  return { weather: null, impact: null, action: null, needs_editor: true, validation_issues: last.issues };
}

module.exports = { buildEventPrompt, narrateEventImpact };
