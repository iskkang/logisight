'use strict';
const test = require('node:test');
const assert = require('node:assert');

const { findJargon, checkJargon, jargonFeedback } = require('./jargon');

// 2026-06호 발행본에 실제로 실린 문장. 독자가 이걸 봤다.
const LEAKED_FX = 'fxYoyPctで示される為替の寄与は+11.2%であり、円ベースの伸び+52.8%のうち+11.2%が為替だった。';
const LEAKED_ERAI = 'なお、ここでのchangePctは前年同月比ではなく前月比である点に注意したい。';

test('발행본에 실렸던 필드명을 잡는다', () => {
  const a = checkJargon(LEAKED_FX);
  assert.equal(a.ok, false);
  assert.equal(a.hits[0].token, 'fxYoyPct');

  const b = checkJargon(LEAKED_ERAI);
  assert.equal(b.ok, false);
  assert.equal(b.hits[0].token, 'changePct');
});

test('정상적인 일본어 본문은 통과한다', () => {
  const body = '外航貨物輸送は円ベース233.8(前年同月比+52.8%)、契約通貨ベース160.8(+37.4%)だった。'
    + '為替換算による上乗せは+11.2%である。';
  assert.equal(checkJargon(body).ok, true);
});

// 지수명은 전부 대문자다. camelCase 규칙에 걸리면 안 된다.
test('지수·단위의 대문자 표기는 잡지 않는다', () => {
  const body = 'SCFI総合は3205.97、WCIは4255、BDIは2705。VLSFOは861、HSFOは767。'
    + 'ERAIは3704。取扱量は117万7717TEUで、出所はPIERSとCTS社である。';
  assert.deepEqual(findJargon(body), []);
});

test('치환 실패 흔적을 잡는다', () => {
  for (const bad of ['値はundefinedだった。', '前年比はNaN%である。', '対象は[object Object]。', '{{period}}の数値。', '${total}TEU。']) {
    assert.equal(checkJargon(bad).ok, false, bad);
  }
});

test('snake_case 컬럼명을 잡는다', () => {
  const r = checkJargon('published_at を基準に並べている。');
  assert.equal(r.ok, false);
  assert.equal(r.hits[0].token, 'published_at');
});

// 표는 코드가 그리므로 검사 대상이 아니다. 본문만 본다.
test('표 행은 보지 않는다', () => {
  const body = ['| 港湾 | teu_total |', '| 東京港 | 367,332 |', '取扱量は36万7332TEUだった。'].join('\n');
  assert.deepEqual(findJargon(body), []);
});

test('지적문에 걸린 토큰과 문맥이 들어간다', () => {
  const fb = jargonFeedback(checkJargon(LEAKED_FX));
  assert.match(fb, /fxYoyPct/);
  assert.match(fb, /日本語に言い換える/);
});

test('여러 건이면 모두 잡는다', () => {
  const r = checkJargon(`${LEAKED_FX}\n${LEAKED_ERAI}`);
  assert.equal(r.hits.length, 2);
});
