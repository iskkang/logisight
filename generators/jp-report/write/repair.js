'use strict';
// generators/jp-report/write/repair.js
// 부분 수리 — 마지막 재생성까지 걸렸을 때, 섹션 전체를 다시 쓰지 않고 걸린 문장만 고친다.
//
// 섹션 하나를 다시 쓰는 데 약 2분이 든다. 그런데 막히는 이유는 대개 한 문장이다.
// 2026-09-22 실행의 02. 海運은 「欠航率も再び10%を上回る水準」 한 문장 때문에 미해결로
// 떨어졌고, 그 한 문장 때문에 원고가 조합되지 않았다. 남은 게 그 정도라면
// 3,000자를 다시 쓰는 것보다 한 문장을 고치는 편이 맞다.
//
// 순서:
//   (1) 걸린 문장만 LLM에 넘겨 같은 뜻으로 재작성 → 결정적 검사 재실행
//   (2) 그래도 걸리면 그 문장을 지운 판으로 검사 → 통과하면 "문장 삭제로 해결"
//   (3) 그래도 걸리면 미해결. 통과시키지 않는다.
//
// ■ 검사 기준은 건드리지 않는다
// 수리가 쉬워지라고 수치 검증의 허용 규칙을 넓히지 않는다. 고칠 것은 원고이지
// 검사기가 아니다. 그래서 이 모듈은 판정을 writer와 같은 deterministicChecks로만 본다.
//
// ■ 제목 줄은 지우지 않는다
// 목차·앵커가 소섹션 번호에 의존한다. 제목에 걸린 수치가 있으면 재작성까지만 하고
// 삭제 대상에서는 뺀다.

const { verifyNumbers } = require('../verify/numbers');
const { checkHedges } = require('../verify/hedges');
const { deterministicChecks } = require('../verify/deterministic');

/** 문장 단위로 쪼갠다. 표(|)와 각주(※)는 코드가 찍는 것이라 손대지 않는다. */
function sentencesOf(text) {
  const out = [];
  for (const line of String(text || '').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('|') || trimmed.startsWith('※')) continue;
    for (const piece of line.split(/(?<=。)/)) {
      const s = piece.trim();
      if (s) out.push(s);
    }
  }
  return out;
}

const isHeading = (s) => s.startsWith('#');

/**
 * 재생성·수리 지시문. 작업 지시문의 문구를 그대로 쓴다.
 * 임계값을 새로 지어내는 것을 같이 막지 않으면, 「10%」를 지우고 「15%」를 쓴다.
 */
function numberRule(raws) {
  const list = raws.map((r) => `『${r}』`).join('・');
  return `数値${list}はfactsheetに存在しない。`
    + 'この数値を含む表現を削除するか、factsheetにある実数値に置き換えること。'
    + '閾値・目安の数値も新たに作らないこと。';
}

/** factsheet에 없는 수치가 든 문장들. 문장 단위로 다시 검증해 위치를 특정한다. */
function numberTargets(body, factsheet) {
  const seen = new Set();
  const out = [];
  for (const sentence of sentencesOf(body)) {
    if (seen.has(sentence)) continue;
    const { violations } = verifyNumbers(sentence, factsheet);
    if (violations.length === 0) continue;
    seen.add(sentence);
    out.push({ sentence, raws: violations.map((v) => v.raw), instruction: numberRule(violations.map((v) => v.raw)) });
  }
  return out;
}

/**
 * 수치 위반에 그 문장 원문을 붙인다. 재생성 프롬프트가 ±20자 문맥만 보내던 것을
 * 문장 통째로 바꾸기 위한 것이다 — 문맥이 잘려 있으면 모델이 어디를 고칠지 못 짚는다.
 */
function attachSentences(body, violations, factsheet) {
  const targets = numberTargets(body, factsheet);
  return (violations || []).map((v) => {
    const hit = targets.find((t) => t.raws.includes(v.raw));
    return { ...v, sentence: hit ? hit.sentence : null, rule: numberRule([v.raw]) };
  });
}

/** 상한을 넘은 유보 문장. 앞의 cap개는 남긴다. */
function hedgeTargets(body) {
  const { cap, hits } = checkHedges(body);
  return hits.slice(cap).map((h) => ({
    sentence: h.sentence,
    instruction: `この文は留保(「〜できない」の類)であり、このセクションでは${cap}文までと決まっている。`
      + `${h.at}文目のこの文を、留保を使わずに事実の記述で終える一文に書き換えること。`
      + '新しい数値は持ち込まない。',
  }));
}

/** 지금 걸려 있는 검사에 맞는 수리 대상. 수치와 유보만 문장 단위로 고친다. */
function repairTargets(body, factsheet) {
  const fail = deterministicChecks(body, factsheet);
  if (!fail) return [];
  if (fail.slot === 'number') return numberTargets(body, factsheet);
  if (fail.slot === 'hedge') return hedgeTargets(body);
  return [];
}

/** 문장을 지운 뒤 남는 빈 줄·꼬리 공백을 정리한다. */
function tidy(text) {
  return text
    .split('\n')
    .map((l) => l.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * @param {object} args
 * @param {string} args.body 마지막 재생성까지 걸린 본문
 * @param {object} args.factsheet
 * @param {(sentence: string, instruction: string) => Promise<string>} args.rewrite 한 문장 재작성기
 * @param {(msg: string) => void} [args.log]
 * @returns {Promise<{body: string, ok: boolean, how: 'rewrite'|'delete'|null}>}
 */
async function repairSection({ body, factsheet, rewrite, log = () => {} }) {
  const targets = repairTargets(body, factsheet);
  if (targets.length === 0) return { body, ok: false, how: null };

  // (1) 그 문장만 재작성
  let current = body;
  for (const t of targets) {
    let next = '';
    try {
      next = String((await rewrite(t.sentence, t.instruction)) || '').trim();
    } catch (e) {
      log(`문장 재작성 호출 실패 — ${e.message}`);
    }
    if (!next || next === t.sentence) continue;
    current = current.replace(t.sentence, next);
  }
  if (!deterministicChecks(current, factsheet)) {
    log(`문장 재작성으로 해결 (${targets.length}문)`);
    return { body: current, ok: true, how: 'rewrite' };
  }

  // (2) 그래도 걸리면 그 문장을 지운다. 제목 줄은 지우지 않는다.
  const leftover = repairTargets(current, factsheet).filter((t) => !isHeading(t.sentence));
  if (leftover.length === 0) return { body, ok: false, how: null };
  let stripped = current;
  for (const t of leftover) stripped = stripped.replace(t.sentence, '');
  stripped = tidy(stripped);
  if (stripped && !deterministicChecks(stripped, factsheet)) {
    log(`문장 삭제로 해결 (${leftover.length}문 삭제)`);
    return { body: stripped, ok: true, how: 'delete' };
  }

  return { body, ok: false, how: null };
}

module.exports = {
  sentencesOf, numberRule, numberTargets, attachSentences, hedgeTargets, repairTargets, repairSection,
};
