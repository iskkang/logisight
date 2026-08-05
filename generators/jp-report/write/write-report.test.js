'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { userPrompt, digestOf } = require('./write-report');
const { byId } = require('./sections');

// 프롬프트 조립은 순수 함수인데 검증이 없었다. 실제로 배열 리터럴을 parts.push(...)로
// 바꾸면서 닫는 괄호를 '];'로 남겨 모듈이 로드 시점에 죽었다 — 테스트가 없어 못 잡았다.
// 이 파일을 require 하는 것만으로 그 부류의 구문 오류는 다시 걸린다.

const SLIM = { periods: { sppi: '2026-06' }, periodMismatch: true, gaps: [], sppi: { series: [] } };

const build = (id, opts = {}) => userPrompt(
  byId(id), opts.slim || SLIM, opts.digests || [], opts.violations || null, opts.issues || null,
);

test('userPrompt: 섹션 번호·제목·의도를 담는다', () => {
  const p = build('port');
  assert.ok(p.includes('05. 港湾'));
  assert.ok(p.includes('速報値であることを必ず明示する'));
});

// 표를 LLM이 그리면 반드시 수치 오류가 섞인다. 코드가 그린 표를 나중에 끼운다.
test('userPrompt: 표 금지 지시가 모든 섹션에 들어간다', () => {
  for (const id of ['overview', 'ocean', 'air', 'rail', 'port', 'trade', 'closing']) {
    assert.ok(build(id).includes('数値の表(マークダウンテーブル)は書かない'), `${id}: 표 금지 누락`);
  }
});

test('userPrompt: 팩트시트가 JSON으로 들어간다', () => {
  assert.ok(build('ocean').includes(JSON.stringify(SLIM)));
});

// 참조 리포트가 02-1·02-2처럼 번호 붙은 소섹션을 갖는다. 지시가 빠지면 평범한 ###가 나온다.
test('userPrompt: 소섹션이 있는 섹션은 번호까지 지시한다', () => {
  const p = build('ocean');
  assert.ok(p.includes('【小見出し構成】'));
  for (const t of byId('ocean').subsections) assert.ok(p.includes(t), `소섹션 누락: ${t}`);
});

test('userPrompt: 소섹션이 없는 섹션에는 그 블록을 넣지 않는다', () => {
  for (const id of ['overview', 'closing']) {
    assert.ok(!build(id).includes('【小見出し構成】'), `${id}: 불필요한 소섹션 블록`);
  }
});

test('userPrompt: 다른 섹션 요지는 있을 때만 넣는다', () => {
  assert.ok(!build('overview').includes('【他セクションの要旨】'));
  const p = build('overview', { digests: [{ title: '港湾', digest: '主要6港は横ばい。' }] });
  assert.ok(p.includes('【他セクションの要旨】'));
  assert.ok(p.includes('主要6港は横ばい。'));
});

// 재생성 때 지적을 실어 보내지 않으면 같은 위반이 반복된다.
test('userPrompt: 수치 위반을 원문·문맥과 함께 되돌려준다', () => {
  const p = build('ocean', { violations: [{ raw: '73ポイント', context: '73ポイントの開き' }] });
  assert.ok(p.includes('【前回の指摘・数値】'));
  assert.ok(p.includes('73ポイント'));
  assert.ok(p.includes('73ポイントの開き'));
});

test('userPrompt: 편집 지적을 되돌려준다', () => {
  const p = build('port', { issues: [{ type: 'speculation', reason: '推測である', quote: '〜とみられる' }] });
  assert.ok(p.includes('【前回の指摘・編集】'));
  assert.ok(p.includes('推測である'));
});

test('userPrompt: 지적이 없으면 지적 블록도 없다', () => {
  const p = build('trade');
  assert.ok(!p.includes('【前回の指摘'));
});

test('userPrompt: 출력 형식 지시로 끝난다', () => {
  assert.match(build('trade').trim(), /前置きや説明は書かない。$/);
});

test('digestOf: 제목을 빼고 앞 2문장만 넘긴다', () => {
  const d = digestOf('## 03. 港湾\n\n合計は117万TEU。東京港が最大。横浜港が最も伸びた。');
  assert.equal(d, '合計は117万TEU。東京港が最大。');
});

test('digestOf: 180자를 넘기지 않는다', () => {
  assert.ok(digestOf(`${'あ'.repeat(400)}。`).length <= 180);
});

// phraseNote가 정의에는 있는데 호출부에 빠져 있었다. 지속 표현 검사가 걸려
// 재생성은 하는데 모델에게 이유를 안 알려주니, 같은 글을 다시 써서 또 걸렸다.
// 인자를 늘릴 때 한쪽만 고치면 조용히 이렇게 된다.
test('userPrompt 호출부가 정의와 인자 수가 같다', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, 'write-report.js'), 'utf8');
  const def = /function userPrompt\(([^)]*)\)/.exec(src)[1].split(',').length;
  const body = src.slice(src.indexOf('async function writeSection'));
  const call = /userPrompt\(section,([^)]*)\)/.exec(body)[1].split(',').length + 1;
  assert.equal(call, def, 'userPrompt 호출부가 정의보다 인자가 적다 — 되먹임이 전달되지 않는다');
});
