'use strict';
// generators/jp-report/verify/jargon.js
// verifier (e) — 개발자만 아는 문자열이 독자에게 나가는 것을 막는다.
//
// 2026-06호 발행본에 이런 문장이 실렸다:
//   「fxYoyPctで示される為替の寄与は+11.2%であり…」
//   「なお、ここでのchangePctは前年同月比ではなく前月比である点に注意したい。」
//
// 원인은 내가 프롬프트에 필드명을 그대로 적은 것이다:
//   '【為替の内訳】fxYoyPct が「前年同月比のうち為替の寄与」である'
// 모델이 그 이름을 본문으로 옮겼다. 프롬프트 문구만 고치면 다음에 또 샌다 —
// 모델은 팩트시트 JSON 자체도 보므로 어느 키든 옮겨 적을 수 있다.
//
// 일본어 리포트 본문에 camelCase가 정당하게 등장할 일은 없다.
// 지수명은 전부 대문자다(SCFI·WCI·BDI·VLSFO·ERAI·TEU·PIERS·CTS).
// 그래서 단순한 규칙으로 확실하게 잡힌다.

/** 치환에 실패했거나 값이 비었을 때 새어나오는 것들. */
const LEAKS = [
  { name: 'undefined', re: /\bundefined\b/g },
  { name: 'NaN', re: /\bNaN\b/g },
  { name: '[object Object]', re: /\[object Object\]/g },
  { name: '미치환 템플릿', re: /\{\{[^}]*\}\}|\$\{[^}]*\}/g },
];

/**
 * camelCase — 필드명이 새어나온 거의 확실한 신호.
 * 앞이 소문자로 시작하고 중간에 대문자가 있는 토큰.
 */
const CAMEL = /\b[a-z][a-z0-9]*[A-Z][a-zA-Z0-9]*\b/g;

/** snake_case — 컬럼명이 새어나온 신호. */
const SNAKE = /\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/g;

/**
 * 예외.
 * 본문에 정당하게 나올 수 있는 영문 표기만 담는다. 지금은 비어 있고,
 * 실제로 필요한 것이 생기면 그때 근거와 함께 추가한다.
 * 미리 채워두면 진짜 누출까지 통과시킨다.
 */
const ALLOW = new Set([]);

/** 표·각주가 아닌 독자가 읽는 본문만 본다. */
function bodyText(text) {
  return String(text || '')
    .split('\n')
    .filter((l) => !l.trim().startsWith('|'))
    .join('\n');
}

/**
 * @param {string} body 섹션 본문 또는 리포트 전문
 * @returns {Array<{kind: string, token: string, context: string}>}
 */
function findJargon(body) {
  const src = bodyText(body);
  const out = [];
  const push = (kind, token, index) => {
    out.push({
      kind,
      token,
      context: src.slice(Math.max(0, index - 30), index + token.length + 30).replace(/\s+/g, ' ').trim(),
    });
  };

  for (const { name, re } of LEAKS) {
    for (const m of src.matchAll(re)) push(name, m[0], m.index);
  }
  for (const m of src.matchAll(CAMEL)) {
    if (!ALLOW.has(m[0])) push('필드명(camelCase)', m[0], m.index);
  }
  for (const m of src.matchAll(SNAKE)) {
    if (!ALLOW.has(m[0])) push('컬럼명(snake_case)', m[0], m.index);
  }
  return out;
}

/** @returns {{ok: boolean, hits: Array}} */
function checkJargon(body) {
  const hits = findJargon(body);
  return { ok: hits.length === 0, hits };
}

/** 재생성 프롬프트에 붙일 지적문. */
function jargonFeedback({ hits }) {
  return [
    '【内部の名称が本文に出ている】ファクトシートの項目名やプログラム上の値は、読者に見せるものではない。',
    '日本語に言い換える。項目名そのものを本文に書かない。',
    ...hits.map((h) => `- 「${h.token}」 … ${h.context}`),
    '例: 「fxYoyPctで示される為替の寄与は+11.2%」→「為替換算による上乗せは+11.2%」',
  ].join('\n');
}

module.exports = { LEAKS, CAMEL, SNAKE, ALLOW, findJargon, checkJargon, jargonFeedback };
