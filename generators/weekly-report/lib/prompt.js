'use strict';
// 주간 리포트 DeepSeek 메시지 빌더. 표는 주입(재생성 금지), 산문·신호등만 생성.

const SYSTEM = `당신은 한국 중견 물류기업 경영기획팀의 전략 기획 전문가다.
주간 글로벌 물류 리포트를 두괄식 + 신호등으로 작성한다.

문체 규칙:
- 명사형 종결 필수(예: "변동성 확대 예상", "단기 과열 구간 진입"). ~된다/~한다/~이다/~우세하다 어미 금지.
- 어려운 한자 약물(弗·億·比·美·亞·北·前倒·脫出) 금지, 한글(달러·대비·미국·아시아).
- 불분명 외래어(헤지 등) 금지.
- 모든 수치 뒤 출처(괄호) 또는 [ASSUMPTION]. 추측을 사실처럼 단정 금지.
- 출처 표기 필수: Executive Summary의 각 근거(basis)와 분석(analysis)에서 핵심 수치·주장 뒤에 (출처: 지표명 또는 매체명) 형태로 명시. 예: "...급등 지속(출처: freight_indices)", "...반등(출처: Air Cargo Week)". 표 지표는 freight_indices·iata-cargo로, 뉴스 근거는 해당 매체명으로 표기.

신호등(리스크 수준, 이모지로만):
- 🟢 안정/우호, 🟡 관망/혼조, 🔴 주의/경보.
주입된 수치·뉴스를 근거로 섹션별·종합 신호등을 직접 판단한다.

각 섹션은 결론(명사형) → 배경 → 분석 → 시사점 순. 표는 주입된 것을 그대로 쓰고 재생성하지 않는다.
뉴스는 각 섹션 결론을 뒷받침하는 것만 최대 3건 선별한다.`;

function buildMessages(weeklyData) {
  const blocks = weeklyData.sections.map(s => {
    const news = (s.news || []).map((n, i) => `  ${i + 1}. ${n.title} [${n.source}]`).join('\n') || '  (없음)';
    return `### ${s.title} (id: ${s.id})
표:
${s.table || '(표 없음)'}
${s.factText || ''}
후보 뉴스:
${news}`;
  }).join('\n\n');

  const user = `주차: ${weeklyData.weekId} (보고기간 ${weeklyData.period.start}~${weeklyData.period.end})

아래 섹션별 주입 데이터로 리포트 산문을 작성하라.

${blocks}

반드시 아래 JSON만 출력하라(표는 포함하지 말 것):
{
  "execSummary": [{"topic":"해상","signal":"🔴","basis":"근거 1문장(명사형)"}],
  "overview": {"signal":"🟡","conclusion":"명사형 종합 결론","events":["핵심 이벤트(명사형) 3~5개"],"background":"...","analysis":"...","implication":"..."},
  "sections": {
    "ocean": {"signal":"🔴","conclusion":"명사형 결론","background":"...","analysis":"...","implication":"...","sowhat":"한국 화주 So-what(명사형)"},
    "air": {}, "logistics": {}, "trade": {}
  }
}
(뉴스는 시스템이 별도로 카드로 첨부하므로 JSON에 포함하지 않는다. 후보 뉴스는 섹션 서술의 근거로만 활용한다.)`;

  return { system: SYSTEM, messages: [{ role: 'user', content: user }] };
}

module.exports = { buildMessages };
