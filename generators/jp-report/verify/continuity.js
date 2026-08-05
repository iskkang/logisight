'use strict';
// generators/jp-report/verify/continuity.js
// verifier (d) — 시간 비교를 함의하는 부사를 잡는다.
//
// STYLE 7절이 「継続性を主張しない」을 이미 금지한다. 그래도 모델이 계속 쓴다.
// 2026-06호 재생성에서 02. 海運이 「上海発が引き続き高水準」이라고 썼는데,
// 항로별 운임은 2026-07-20 한 시점만 있어 "계속"이라고 할 근거가 없다.
// LLM 검수가 이걸 잡긴 했지만 재시도 2회로는 못 고쳤고, 발행이 막혔다.
//
// 이런 말은 단어 수준에서 결정적으로 걸린다. 프롬프트에 맡기지 않는다.
//
// 앞의 값과 비교하는 서술 자체를 막는 것이 아니다 — 팩트시트가 전년동월비를
// 주므로 「前年同月を上回る」는 얼마든지 쓴다. 막는 것은 근거 없이 추세를
// 주장하는 부사다.

/**
 * 시간축의 지속을 함의하는 말.
 *
 * 「上昇した」「下回る」처럼 단월의 사실을 말하는 동사는 넣지 않는다.
 * 넣으면 쓸 수 있는 서술까지 깎인다.
 */
const CONTINUITY = [
  '引き続き',
  '依然として',
  '高止まり',
  '継続している',
  '継続しており',
  '続いている',
  '続いており',
  '相次いで',
  '一貫して',
  'ますます',
  '定着し',
];

function bodyLines(text) {
  return String(text || '')
    .split('\n')
    .filter((l) => !l.trim().startsWith('|') && !l.trim().startsWith('※'))
    .join('\n');
}

/** 지속 표현이 든 문장을 뽑는다. */
function findContinuity(text) {
  const out = [];
  for (const sentence of bodyLines(text).split(/(?<=。)/)) {
    const s = sentence.trim();
    if (!s) continue;
    const hit = CONTINUITY.find((w) => s.includes(w));
    if (hit) out.push({ word: hit, sentence: s });
  }
  return out;
}

/** @returns {{ok: boolean, hits: Array<{word: string, sentence: string}>}} */
function checkContinuity(body) {
  const hits = findContinuity(body);
  return { ok: hits.length === 0, hits };
}

/** 재생성 프롬프트에 붙일 지적문. */
function continuityFeedback({ hits }) {
  return [
    '【継続性の主張】ファクトシートは単月の断面である。推移を示すデータが本文に無いまま、',
    '時間の継続を含意する語を使ってはならない。次の語を消し、単月の事実だけを述べる。',
    ...hits.map((h) => `- 「${h.word}」 … 「${h.sentence}」`),
    '例: 「上海発が引き続き高水準」→「上海→欧州は3155(7月20日時点)」',
  ].join('\n');
}

module.exports = { CONTINUITY, findContinuity, checkContinuity, continuityFeedback };
