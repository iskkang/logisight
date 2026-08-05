'use strict';
const test = require('node:test');
const assert = require('node:assert');

const { findHedges, checkHedges, hedgeFeedback } = require('./hedges');

// 2026-06호 03. 航空의 실제 본문. 세 문장이 연달아 "할 수 없다"로 끝났다.
const AIR_2026_06 = [
  '航空貨物のスポット指数は本レポートのデータに含まれていない。',
  'したがって海運セクションで行ったような世界のスポット指数と日本の価格指数の突き合わせは、航空については行えない。',
  'この点はデータの限界として明記しておく。',
].join('');

test('연달아 세 번 유보하면 걸린다', () => {
  const r = checkHedges(AIR_2026_06);
  assert.equal(r.ok, false);
  assert.equal(r.sentences.length, 3);
});

test('한 문장이면 통과한다 — 유보 자체를 막는 것이 아니다', () => {
  const body = '国際航空貨物輸送は円ベース142.4、契約通貨ベース98.1である。'
    + '契約通貨ベースは基準年を下回る。'
    + 'ただし転嫁の幅は契約条件によって異なり、本レポートのデータからは特定できない。';
  assert.equal(checkHedges(body).ok, true);
});

test('유보가 없어도 통과한다', () => {
  assert.equal(checkHedges('外航貨物輸送は円ベース233.8、契約通貨ベース160.8である。').ok, true);
});

// STYLE 6절이 권장하는 서술이다. 세면 좋은 문장이 깎인다.
test('「一致しない」은 유보가 아니라 사실 지적이다', () => {
  const body = '規模で上位の米国・中国に対し、伸び率で上位に立つのは台湾であり、顔ぶれは一致しない。';
  assert.deepEqual(findHedges(body), []);
});

test('한 문장에 유보 표현이 둘이면 한 번으로 센다', () => {
  const body = 'データを持っておらず、需給どちらから動いているかは説明できない。';
  assert.equal(findHedges(body).length, 1);
});

// 표의 각주(※)는 데이터 설명이라 본문의 유보와 성격이 다르다.
test('표 행과 각주는 세지 않는다', () => {
  const body = [
    '| 港湾 | 合計 |',
    '| 東京港 | 367,332 |',
    '※ 速報値であり、確報とは確定度が異なる。全国計は含まれていない。',
    '主要6港の合計は117万7717TEUだった。',
  ].join('\n');
  assert.deepEqual(findHedges(body), []);
});

test('지적문에 걸린 문장이 모두 들어간다', () => {
  const fb = hedgeFeedback(checkHedges(AIR_2026_06));
  assert.match(fb, /3つある/);
  assert.match(fb, /1つまでにする/);
  assert.match(fb, /データの限界として明記しておく/);
});
