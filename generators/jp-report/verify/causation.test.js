'use strict';
const test = require('node:test');
const assert = require('node:assert');

const { findCausation, checkCausation, causationFeedback } = require('./causation');

// 2026-06호 발행본에 실제로 실린 문장.
test('가산 분해를 잡는다 — 곱 관계인데 뺄셈 구성요소처럼 썼다', () => {
  const body = '円ベース+52.8%のうち為替が+11.2%、運賃そのものは+37.4%と分けて読む必要がある。';
  const r = checkCausation(body);
  assert.equal(r.ok, false);
  assert.equal(r.hits[0].kind, '加算での分解');
});

test('「半分近く」류를 잡는다 — 실제로는 31.2%다', () => {
  const r = checkCausation('円ベースの水準の半分近くを為替が押し上げた。');
  assert.equal(r.ok, false);
  // 인과 단정이 먼저 걸린다. 둘 다 문제다.
  assert.ok(r.hits.length >= 1);
});

test('인과 단정을 잡는다', () => {
  for (const bad of [
    '円安が主な要因である。',
    '為替が指数を押し上げた。',
    '燃料高が市場をけん引した。',
    '円安によって上昇した。',
  ]) {
    assert.equal(checkCausation(bad).ok, false, bad);
  }
});

// STYLE이 쓰라고 지시하는 표현이다. 세면 쓸 수 있는 문장까지 깎인다.
test('관측 서술은 잡지 않는다', () => {
  const body = '円ベースの指数には、契約通貨建て価格に加えて為替換算の影響が反映されている。'
    + '同時期に世界のスポット指数の上昇が確認された。'
    + '円ベース指数は契約通貨ベース指数を45.4%上回っている。';
  assert.deepEqual(findCausation(body), []);
});

// 지시서가 권한 형태. 이게 통과해야 한다.
test('단순차와 상승률을 나눠 쓴 문장은 통과한다', () => {
  const body = '円ベースの前年同月比は+52.8%、契約通貨ベースは+37.4%だった。'
    + '両者の単純差は15.4ポイントである。'
    + '契約通貨ベースの伸びに対する為替換算上の上乗せ率を比率で算出すると、約11.2%となる。';
  assert.equal(checkCausation(body).ok, true);
});

test('표 행은 보지 않는다', () => {
  const body = ['| 系列 | 押し上げた |', '| 外航 | 233.8 |'].join('\n');
  assert.deepEqual(findCausation(body), []);
});

test('지적문이 무엇을 어떻게 고칠지 말해준다', () => {
  const fb = causationFeedback(checkCausation('円ベース+52.8%のうち為替が+11.2%だった。'));
  assert.match(fb, /積の関係/);
  assert.match(fb, /15\.4ポイント/);
});
