'use strict';
// generators/jp-report/verify/deterministic.js
// 호출이 없는 검사들을 한자리에 모은다 — 수치·유보·지속·내부명칭·인과.
//
// 한곳에 모아두는 이유: 저장분을 되쓸 때도 이것들은 전부 다시 돌려야 한다.
// 검사기를 새로 추가했을 때, 예전에 통과한 본문이 그 검사를 건너뛰면 안 된다.
//
// writer(write-report.js)와 부분 수리(write/repair.js)가 같은 판정을 봐야 해서
// 모듈로 뺐다. 수리한 본문을 writer와 다른 기준으로 통과시키면 그 구멍으로
// 검사를 못 받은 문장이 나간다.

const { verifyNumbers } = require('./numbers');
const { checkHedges, hedgeFeedback } = require('./hedges');
const { checkContinuity, continuityFeedback } = require('./continuity');
const { checkJargon, jargonFeedback } = require('./jargon');
const { checkCausation, causationFeedback } = require('./causation');

/**
 * 하나라도 걸리면 그 자리에서 돌려준다.
 * @returns {null|{label: string, slot: string, violations?: Array, note?: string}}
 */
function deterministicChecks(body, factsheet) {
  const numbers = verifyNumbers(body, factsheet);
  if (!numbers.ok) {
    return { label: `수치 위반 ${numbers.violations.length}건`, violations: numbers.violations, slot: 'number' };
  }
  const hedges = checkHedges(body);
  if (!hedges.ok) {
    return { label: `유보 문구 ${hedges.sentences.length}건(상한 ${hedges.cap})`, note: hedgeFeedback(hedges), slot: 'hedge' };
  }
  const continuity = checkContinuity(body);
  if (!continuity.ok) {
    return { label: `지속 표현 ${continuity.hits.length}건`, note: continuityFeedback(continuity), slot: 'phrase' };
  }
  const jargon = checkJargon(body);
  if (!jargon.ok) {
    return {
      label: `내부 명칭 노출 ${jargon.hits.length}건(${jargon.hits.map((h) => h.token).join(', ')})`,
      note: jargonFeedback(jargon), slot: 'jargon',
    };
  }
  const causation = checkCausation(body);
  if (!causation.ok) {
    return { label: `인과·비율 표현 ${causation.hits.length}건`, note: causationFeedback(causation), slot: 'cause' };
  }
  return null;
}

module.exports = { deterministicChecks };
