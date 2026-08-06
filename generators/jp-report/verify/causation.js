'use strict';
// generators/jp-report/verify/causation.js
// verifier (f) — 데이터로 확인할 수 없는 인과 단정과 %/포인트 혼동을 잡는다.
//
// 2026-06호 발행본에서 나온 것들:
//   「円ベース+52.8%のうち為替が+11.2%、運賃そのものは+37.4%」
//     → 11.2와 37.4를 더해도 52.8이 안 된다. 곱 관계인데 뺄셈 구성요소처럼 썼다.
//   「円ベースの水準の半分近くを為替が押し上げた」
//     → 지수차 73.0은 円ベース 233.8의 31.2%다. 절반이 아니고, 「押し上げた」는 인과 단정이다.
//
// 팩트시트에 있는 것은 두 기준의 값뿐이다. 어느 쪽이 어느 쪽을 움직였는지는 없다.

/**
 * 인과를 단정하는 말.
 *
 * 「影響が反映されている」「同時期に上昇が確認された」처럼 관측을 서술하는 표현은 넣지 않는다.
 * STYLE이 그쪽을 쓰라고 지시하므로, 세면 쓸 수 있는 문장까지 깎인다.
 */
const CAUSATION = [
  '主な要因である',
  '主因である',
  'そのまま運賃に上乗せ',
  '押し上げた',
  '押し上げている',
  'けん引した',
  '牽引した',
  'が原因である',
  'によって上昇した',
  'によって下落した',
  'をもたらした',
];

/**
 * 「うち〜が」로 곱 관계를 뺄셈처럼 쓰는 형태.
 * 円ベースの伸びを 為替 + 運賃 으로 가르는 문장이 여기 걸린다.
 */
const ADDITIVE_SPLIT = /(?:円ベース)[^。]{0,20}\+?\d+(?:\.\d+)?\s*[%％][^。]{0,12}のうち[^。]{0,24}為替[^。]{0,12}\+?\d+(?:\.\d+)?\s*[%％]/;

/** 지수의 차를 「절반」류로 뭉뚱그리는 형태. */
const VAGUE_HALF = /(半分|過半|大半|ほとんど)[^。]{0,16}(為替|円安)/;

function bodyLines(text) {
  return String(text || '')
    .split('\n')
    .filter((l) => !l.trim().startsWith('|'))
    .join('\n');
}

/** @returns {Array<{kind: string, hit: string, sentence: string}>} */
function findCausation(text) {
  const out = [];
  for (const sentence of bodyLines(text).split(/(?<=。)/)) {
    const s = sentence.trim();
    if (!s) continue;
    const word = CAUSATION.find((w) => s.includes(w));
    if (word) { out.push({ kind: '因果の断定', hit: word, sentence: s }); continue; }
    const add = ADDITIVE_SPLIT.exec(s);
    if (add) { out.push({ kind: '加算での分解', hit: add[0].slice(0, 40), sentence: s }); continue; }
    const half = VAGUE_HALF.exec(s);
    if (half) out.push({ kind: '割合のあいまいな表現', hit: half[0], sentence: s });
  }
  return out;
}

function checkCausation(body) {
  const hits = findCausation(body);
  return { ok: hits.length === 0, hits };
}

function causationFeedback({ hits }) {
  const lines = ['【断定と分解】ファクトシートにあるのは二つの基準の値だけで、どちらがどちらを動かしたかは無い。'];
  for (const h of hits) {
    if (h.kind === '加算での分解') {
      lines.push(`- 「${h.hit}」 … 円ベースと契約通貨ベースは積の関係で、足し算では合わない。`
        + '「単純差は15.4ポイント」「為替換算による上乗せ率は+11.2%」のように分けて書く。');
    } else if (h.kind === '割合のあいまいな表現') {
      lines.push(`- 「${h.hit}」 … 割合は数字で書く。「円ベース指数は契約通貨ベース指数を45.4%上回る」の形にする。`);
    } else {
      lines.push(`- 「${h.hit}」 … 「影響が反映されている」「同時期に上昇が確認された」に言い換える。`);
    }
  }
  return lines.join('\n');
}

module.exports = { CAUSATION, ADDITIVE_SPLIT, VAGUE_HALF, findCausation, checkCausation, causationFeedback };
