'use strict';
const test = require('node:test');
const assert = require('node:assert');

const { findContinuity, checkContinuity, continuityFeedback } = require('./continuity');

// 2026-06호 재생성에서 실제로 나온 문장. 항로별은 7/20 한 시점뿐이라
// 「引き続き」의 근거가 없다. 이 한 건 때문에 발행이 막혔다.
const OCEAN = '航路別では上海発が引き続き高水準で、上海→欧州3155、上海→米西岸5535(いずれも7月20日時点)となっている。';

test('근거 없는 지속 부사를 잡는다', () => {
  const r = checkContinuity(OCEAN);
  assert.equal(r.ok, false);
  assert.equal(r.hits[0].word, '引き続き');
});

test('단월의 사실 서술은 통과한다', () => {
  const body = '上海→欧州は3155、上海→米西岸は5535(いずれも7月20日時点)である。'
    + 'SCFI総合は3205.97で前週比+4.67%と上昇した。';
  assert.equal(checkContinuity(body).ok, true);
});

// 팩트시트가 전년동월비를 주므로 이런 비교는 근거가 있다. 막으면 쓸 수 있는 서술이 깎인다.
test('전년동월비에 근거한 비교는 막지 않는다', () => {
  const body = '外航貨物輸送は円ベース233.8で前年同月を52.8%上回る。契約通貨ベースは基準年を下回る。';
  assert.deepEqual(findContinuity(body), []);
});

test('표 행과 각주는 보지 않는다', () => {
  const body = ['| 港湾 | 合計 |', '※ 高止まりの定義は付記しない。', '東京港は36万7332TEUだった。'].join('\n');
  assert.deepEqual(findContinuity(body), []);
});

test('여러 건이면 모두 잡는다', () => {
  const body = '運賃は高止まりしている。欠航は依然として多い。';
  assert.equal(findContinuity(body).length, 2);
});

test('지적문에 걸린 말과 문장이 들어간다', () => {
  const fb = continuityFeedback(checkContinuity(OCEAN));
  assert.match(fb, /引き続き/);
  assert.match(fb, /単月の断面/);
});
