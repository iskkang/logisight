'use strict';
// 신호 사실을 주입해 DeepSeek가 섹션별 분석 문장을 쓰게 한다. 수치 창작 금지.

const SYSTEM = `당신은 한국 화주·포워더를 위한 운임 애널리스트다.
주어진 운임 신호(수치는 이미 계산됨)를 근거로 "운임 인텔리전스 브리프"의 분석 문장을 쓴다.

문체 규칙:
- 명사형 종결 필수(예: "상승 압력 지속 예상"). ~된다/~한다/~이다 어미 금지.
- 어려운 한자 약물(弗·億·比·美·亞·北·前倒·脫出) 금지, 한글(달러·대비·미국·아시아).
- 화주 관점에서 실무 시사점 포함.
- 주어진 수치만 인용한다. 수치를 새로 만들지 않는다.
각 섹션 2~3문장. 상관·추정 표현만 쓰고 인과 단정 금지.`;

function buildMessages(signals, meta) {
  const facts = signals.map((s) => `- [${s.label}] 상태=${s.state} · ${s.basis}`).join('\n');
  const user = `기준일: ${meta.asOf}

아래 신호를 근거로 브리프를 작성하라.
${facts}

반드시 아래 JSON만 출력하라(수치는 위 신호의 것만 인용):
{
  "headline": "이번 주 핵심을 한 문장(명사형)으로",
  "ocean":  "해상 운임 압력 분석 (백분위·증감 인용)",
  "global": "글로벌 SCFI·WCI 모멘텀 분석",
  "air":    "항공 운임 변동·모달 시사점 (신호 없으면 빈 문자열)",
  "outlook":"단기 전망·부킹/계약 시사점"
}`;
  return { system: SYSTEM, messages: [{ role: 'user', content: user }] };
}

module.exports = { buildMessages };
