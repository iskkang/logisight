'use strict';
// generators/jp-report/verify/hedges.js
// verifier (c) — 유보 문구의 개수를 센다.
//
// 「何が言えないか」를 밝히는 것은 신뢰를 올린다. STYLE 6절이 그렇게 지시한다.
// 그런데 상한이 없어서 2026-06호는 본문 30단락에 유보 문장이 17개 들어갔다.
// 03. 航空은 세 문장이 연달아 "할 수 없다"로 끝난다:
//   「航空貨物のスポット指数は本レポートのデータに含まれていない。」
//   「…突き合わせは、航空については行えない。」
//   「この点はデータの限界として明記しておく。」
// 같은 말을 세 번 하는 것은 정직이 아니라 분량 채우기다. 유료 독자가 마지막에
// 받는 말이 "말할 수 없다"이면 다음 호를 사지 않는다.
//
// 프롬프트로 "줄여라"라고만 하면 회차마다 흔들린다. 코드로 세서 재생성을 건다.
// 수치 검증(numbers.js)과 같은 자리에서 돈다.

/**
 * 유보로 세는 표현.
 *
 * 「規模上位と伸び率上位は一致しない」처럼 사실을 짚는 말은 넣지 않는다.
 * STYLE 6절이 「顔ぶれの違い」로 오히려 권장하는 서술이라, 세면 좋은 문장이 깎인다.
 */
const HEDGE = [
  '特定できない',
  '説明できない',
  '説明することはできない',
  '判断できない',
  '比較することはできない',
  '材料ではない',
  '行えない',
  '裏付けることはできない',
  '言うことはできない',
  'とは言えない',
  '分からない',
  'データの限界',
  '持っていない',
  '持っておらず',
  '含まれていない',
  '対象外であり',
  '待つ必要がある',
  '待たなければ',
];

/** 섹션당 허용 개수. STYLE 6절의 「一文で断る」 그대로 한 문장. */
const DEFAULT_CAP = 1;

/** 표 행은 세지 않는다. 각주(※)도 데이터 설명이라 본문과 다르다. */
function bodyLines(text) {
  return String(text || '')
    .split('\n')
    .filter((l) => !l.trim().startsWith('|') && !l.trim().startsWith('※'))
    .join('\n');
}

/** 본문을 문장으로 쪼갠다. 몇 번째 문장인지를 지적문에 실어 보내려면 전체가 필요하다. */
function bodySentences(text) {
  return bodyLines(text).split(/(?<=。)/).map((s) => s.trim()).filter(Boolean);
}

/** 유보 표현이 든 문장을 뽑는다. 한 문장에 두 개가 있어도 한 번으로 센다. */
function findHedges(text) {
  return bodySentences(text).filter((s) => HEDGE.some((h) => s.includes(h)));
}

/**
 * @param {string} body 섹션 본문
 * @param {number} [cap] 허용 개수
 * @returns {{ok: boolean, cap: number, sentences: string[], hits: Array<{sentence: string, at: number}>}}
 *   hits.at — 본문에서 몇 번째 문장인지(1부터). 재생성 피드백과 부분 수리가 위치를 짚는 데 쓴다.
 */
function checkHedges(body, cap = DEFAULT_CAP) {
  const all = bodySentences(body);
  const sentences = all.filter((s) => HEDGE.some((h) => s.includes(h)));
  const hits = sentences.map((s) => ({ sentence: s, at: all.indexOf(s) + 1 }));
  return { ok: sentences.length <= cap, cap, sentences, hits };
}

/**
 * 재생성 프롬프트에 붙일 지적문.
 *
 * 어느 것을 남기고 어느 것을 지울지까지 지정한다. 「減らせ」만 보냈더니 모델이
 * 문장을 바꿔 쓰면서 개수는 그대로 두는 일이 회차마다 반복됐다.
 * 앞의 cap개를 남기고 나머지를 번호로 지목한다.
 */
function hedgeFeedback({ cap, sentences, hits }) {
  const list = hits || sentences.map((sentence) => ({ sentence, at: null }));
  const mark = (h, i) => {
    const at = h.at ? `${h.at}文目` : '該当文';
    return i < cap
      ? `- (${at}) 「${h.sentence}」 … これは残してよい。`
      : `- (${at}) 「${h.sentence}」 … これを削るか、事実の記述で終える文に書き換える。`;
  };
  return [
    `【留保の多用】このセクションに「〜できない」「〜を待つ必要がある」の類の文が${sentences.length}つある。${cap}つまでにする。`,
    '最も重要な一つを残し、残りは削るか、言えることに書き換える。',
    'データが無いことを繰り返し断るより、有るデータで言えることを増やす。',
    '書き換えの例1: 「航空のスポット指数は本レポートのデータに含まれていない。」',
    '  → 「国際航空貨物輸送は円ベース142.4、契約通貨ベース98.1である。」(事実の記述で終える)',
    '書き換えの例2: 「需給のどちらから動いたかは説明できない。」',
    '  → 「公表された直近回の欠航は49便(6%)である。」(有る数字で言えることを述べる)',
    ...list.map(mark),
  ].join('\n');
}

module.exports = { HEDGE, DEFAULT_CAP, bodySentences, findHedges, checkHedges, hedgeFeedback };
