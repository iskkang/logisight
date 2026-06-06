'use strict';
// 전망 산문 생성 — LLM은 statement/impact_note만 작성. 방향·수치는 코드(verdict)에서 온다.
// 검증(Decision 1b): LLM이 echo한 방향이 verdict와 일치 + 금지어 없음 + 확률 표현 존재. 1회 재생성 후 실패 시 산문 없는 draft.

const FORBIDDEN = ['때문에', '확실', '반드시', '틀림없', '분명히'];
const HEDGES = ['가능성', '추정', '정합', '전망', '예상', '우세', '보인다', '보임'];

function buildNarratePrompt(input, verdict, news = []) {
  const system = [
    '당신은 한국 화주·포워더를 위한 물류 인텔리전스 애널리스트다. 아래 계산된 판정과 근거 수치만 사용해 산문을 쓴다.',
    '규칙(엄수):',
    '- statement는 "현상 → 원인 → 배경 → 전망" 흐름의 자연스러운 산문(라벨/소제목 금지).',
    '- 방향·범위·수치를 새로 만들지 마라. 주어진 판정(direction/expected_range_pct)과 근거 수치만 사용.',
    '- 단정·인과 단정 금지("때문에"·"확실"·"반드시" 등 불가). 확률·추정 표현 강제("가능성"·"추정"·"정합").',
    '- 선행/후행 판정 금지.',
    '- 최근 뉴스가 주어지면 시황의 원인·배경을 설명하는 정성 근거로만 활용한다. 뉴스에서 새 수치·방향을 만들지 말고, 주어진 판정과 어긋나는 해석을 하지 마라.',
    '- impact_note는 독자 단위 3단 변환 필수: 지수 변화 → FEU/kg당 비용·리드타임 영향(구간) → 권장 행동 1개.',
    '- 출력은 JSON 하나: {"statement":"...","impact_note":"...","direction_echo":"up|flat|down"}. direction_echo는 주어진 판정 방향을 그대로 반향.',
  ].join('\n');

  const facts = {
    지표: input.metric_ref, 라벨: input.label, 케이던스: input.cadence, horizon: input.horizon_date,
    판정: { 방향: verdict.direction, 강도: verdict.strength, 예상범위: verdict.expected_range_pct, 신뢰도: verdict.confidence },
    근거: {
      최신값: input.rate_series && input.rate_series.latest,
      변화율: input.rate_series && input.rate_series.mom_pct,
      결항: input.supply && input.supply.blank_sailing,
      유가MoM: input.cost && input.cost.fuel_mom_pct,
      수출모멘텀: input.demand && input.demand.export_momentum_yoy_pct,
    },
  };
  const newsBlock =
    news && news.length
      ? `\n\n[최근 관련 해운 뉴스 — 정성 근거]\n${news
          .slice(0, 12)
          .map((n, i) => `${i + 1}. ${n.title}${n.summary ? ` — ${n.summary}` : ""}`)
          .join("\n")}`
      : "";
  const user = `다음 판정과 근거로 전망 산문을 작성하라(JSON만 출력).\n${JSON.stringify(facts, null, 2)}${newsBlock}`;
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

function validateProse(parsed, verdict) {
  const issues = [];
  if (!parsed) return { ok: false, issues: ['파싱 실패'] };
  const s = typeof parsed.statement === 'string' ? parsed.statement.trim() : '';
  const note = typeof parsed.impact_note === 'string' ? parsed.impact_note.trim() : '';
  if (!s) issues.push('statement 비어있음');
  if (!note) issues.push('impact_note 비어있음');
  if (parsed.direction_echo !== verdict.direction) issues.push(`방향 불일치(${parsed.direction_echo} ≠ ${verdict.direction})`);
  if (s && FORBIDDEN.some((w) => s.includes(w))) issues.push('인과/단정 표현 포함');
  if (s && !HEDGES.some((w) => s.includes(w))) issues.push('확률/추정 표현 없음');
  return { ok: issues.length === 0, issues };
}

// callLLM: async ({system,user}) => string. 검증 통과까지 1회 재생성, 실패 시 산문 없는 draft.
async function narrate(callLLM, input, verdict, { maxRetries = 1, news = [] } = {}) {
  const prompt = buildNarratePrompt(input, verdict, news);
  let last = { issues: ['미실행'] };
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const raw = await callLLM(prompt);
    const parsed = safeParse(raw);
    const v = validateProse(parsed, verdict);
    last = v;
    if (v.ok) return { statement: parsed.statement.trim(), impact_note: parsed.impact_note.trim(), needs_editor: false };
  }
  return { statement: null, impact_note: null, needs_editor: true, validation_issues: last.issues };
}

module.exports = { buildNarratePrompt, validateProse, narrate, safeParse, FORBIDDEN, HEDGES };
