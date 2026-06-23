'use strict';
// 기후 영향 AI 초안 산문 — LLM은 3단 본문(기상 변화/영향/권장행동)만. 입력은 실데이터만.
// 환각 차단: 입력에 없는 항만·수치·예보경로 생성 금지. 정량은 범위+추정만, 근거 없으면 정성만.
// 표현: 확률·추정, 인과 단정 금지. status는 항상 draft(에디터 검수 후 발행) — row.js 참조.

const FORBIDDEN = ['확실', '반드시', '틀림없', '분명히', '할 것이다'];
const HEDGE = /(추정|가량|약\s|예상|범위|내외|정도|~|∼|〜|가능성|로 보인다|수 있다)/;

function buildClimatePrompt(ctx) {
  const { event, route, viaPassage, viaMinKm, sharedRoutes = [], trackSummary = {}, nearbyAssets = [] } = ctx;
  const system = [
    '당신은 글로벌 해상물류 리스크 분석가다. 아래 "실데이터"만 사용해 한국어로 기후 영향 초안을 쓴다. 입력(event_route_impacts·track)에 없는 노선·항만·수치·사실을 만들지 않는다.',
    '[중요 — 신호 가중] asset_risk score는 평시 기상장(바람·파고·강설 등)만 반영하며, 활성 이벤트(태풍·홍수)는 그 점수에 들어있지 않은 별개 신호다. 점수가 낮아도(예: 0) 활성 이벤트가 근접하면 리스크는 높을 수 있다. 두 신호를 모두 가중해 서술하라.',
    '[중요 — 귀속 근거] 이 노선이 영향받는 이유는 "이벤트의 예보트랙이 관문(passage)을 통과"하기 때문이다. 반드시 그 관문(via_passage)을 본문에 명시하라(왜 이 노선인지 = 트랙이 이 관문을 지나서).',
    '[본문 — JSON 3필드]',
    '1) weather(기상 리스크 변화): 이벤트 강도·현재 위치 + 예보트랙의 진행 방향과 통과하는 관문. 트랙 점에는 예보시각이 없으므로 "+1/+3일" 같은 시점을 만들지 마라(방향·통과 관문만). 제공된 트랙 끝점 너머의 위치를 단언하지 마라.',
    '2) impact(영향): 그 관문을 지나는 해당 노선의 리드타임·적체 가능성. 정량은 범위+추정으로만(예: "리드타임 +2~4일가량 추정"), 근거 수치 없으면 정성으로만("지연 가능성↑"). 가짜 정밀(임의 지연일·비용) 금지.',
    '3) action(권장 행동): 화주·운영자가 취할 행동 1개.',
    '[분량] weather·impact는 각각 4~5문장 이내로 간결하게, action은 1~2문장.',
    '[표현 규칙] 확률·추정 표현을 쓰고, 인과를 단정하지 마라(정합/추정/상관 수준). "확실/반드시/틀림없/분명히/~할 것이다"류 단정 금지.',
    '출력은 JSON 하나: {"weather":"...","impact":"...","action":"...","event_echo":"<이벤트명 그대로>"}. event_echo는 주어진 이벤트명을 그대로 반복.',
  ].join('\n');

  const ts = trackSummary;
  const facts = {
    기준일: ctx.asof.toISOString().slice(0, 10),
    이벤트: {
      명칭: event.name,
      원문_타이틀: event.title,
      종류: event.kind,
      심각도: event.severity === 'r' ? '경보(red)' : '주의(orange)',
      현재좌표: event.lon != null ? [event.lon, event.lat] : null,
      권역: event.area || null,
    },
    예보트랙: ts.hasTrack
      ? { 진행방향: ts.direction, 현재: ts.current, 관문통과지점: ts.via, 트랙끝: ts.end, 점수: ts.points, 주의: '점별 예보시각 없음 — 시점 단정 금지, 끝점 너머 단언 금지' }
      : '없음(점 이벤트) — 단일좌표 기준',
    걸린_관문: { 관문: viaPassage.name_ko, 트랙_최소거리_km: Math.round(viaMinKm) },
    전파_노선: { id: route.id, 이름: route.name },
    관문_공유_다른노선: sharedRoutes.map((r) => r.name),
    근접_자산: nearbyAssets.map((a) => ({
      이름: a.name, 유형: a.type, 거리_km: Math.round(a.km),
      평시리스크: a.risk ? { score: a.risk.score, level: a.risk.level, driver: a.risk.driver } : '데이터 없음',
    })),
  };
  const user = `다음 실데이터로 기후 영향 초안을 작성하라(JSON만).\n${JSON.stringify(facts, null, 2)}`;
  return { system, user };
}

function safeParse(raw) {
  try {
    let t = String(raw).replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    const s = t.indexOf('{'); const e = t.lastIndexOf('}');
    if (s >= 0 && e > s) t = t.slice(s, e + 1);
    return JSON.parse(t);
  } catch (_) { return null; }
}

function validateClimate(parsed, ctx) {
  const issues = [];
  if (!parsed) return { ok: false, issues: ['파싱 실패'] };
  const weather = typeof parsed.weather === 'string' ? parsed.weather.trim() : '';
  const impact = typeof parsed.impact === 'string' ? parsed.impact.trim() : '';
  const action = typeof parsed.action === 'string' ? parsed.action.trim() : '';
  if (!weather) issues.push('weather 비어있음');
  if (!impact) issues.push('impact 비어있음');
  if (!action) issues.push('action 비어있음');

  const all = `${weather}\n${impact}\n${action}`;
  if (FORBIDDEN.some((w) => all.includes(w))) issues.push('단정 표현 포함');

  // 이벤트 echo 일치(환각 방지) — 다른 이벤트로 바뀌지 않았는지.
  const echo = typeof parsed.event_echo === 'string' ? parsed.event_echo.trim() : '';
  if (!echo || !ctx.event.name.includes(echo) && !echo.includes(ctx.event.name)) {
    issues.push(`이벤트 echo 불일치(${echo || '없음'}≠${ctx.event.name})`);
  }

  // 지연일/일수 수치는 범위+추정 표지 동반 필수 — 가짜 정밀·임의 지연일 차단.
  if (/\d+\s*일/.test(impact) && !HEDGE.test(impact)) issues.push('정량(지연일) 추정·범위 표현 누락');

  // 분량 가드 — 폭주 방지용 느슨한 상한(태풍 초안은 강도·위치·트랙부재·평시대비 가중으로 자연히 길다).
  if (weather.length > 520) issues.push(`weather 분량 초과(${weather.length}>520)`);
  if (impact.length > 520) issues.push(`impact 분량 초과(${impact.length}>520)`);
  if (action.length > 220) issues.push(`action 분량 초과(${action.length}>220)`);

  return { ok: issues.length === 0, issues };
}

// callLLM: async ({system,user}) => string. 검증 통과까지 maxRetries 재생성, 실패 시 빈 본문 draft.
async function narrateClimate(callLLM, ctx, { maxRetries = 1 } = {}) {
  const prompt = buildClimatePrompt(ctx);
  let last = { issues: ['미실행'] };
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const raw = await callLLM(prompt);
    const parsed = safeParse(raw);
    const v = validateClimate(parsed, ctx);
    last = v;
    if (v.ok) {
      return {
        weather: parsed.weather.trim(),
        impact: parsed.impact.trim(),
        action: parsed.action.trim(),
        needs_editor: false,
      };
    }
  }
  return { weather: null, impact: null, action: null, needs_editor: true, validation_issues: last.issues };
}

module.exports = { buildClimatePrompt, validateClimate, narrateClimate, safeParse, FORBIDDEN };
