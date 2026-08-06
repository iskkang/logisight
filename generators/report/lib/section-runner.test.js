'use strict';
const test = require('node:test');
const assert = require('node:assert');

const { pickRevision } = require('./section-runner');

const DRAFT = '8월 컨테이너 운임은 태평양 항로를 중심으로 하락했다. '.repeat(20);
const GOOD = '8월 컨테이너 운임은 태평양 항로에서 하락했다. '.repeat(20);

// 2026-08호에서 실제로 벌어진 일. sonnet-5의 사고 과정이 예산을 다 먹고
// 본문 블록이 비어 돌아왔는데 코드가 그 빈 값을 채택했다. air.md가 398바이트로 남았다.
test('PASS 2가 비어 오면 초안을 지킨다', () => {
  assert.equal(pickRevision(DRAFT, '', 'end_turn'), DRAFT);
  assert.equal(pickRevision(DRAFT, '   \n  ', 'end_turn'), DRAFT);
});

// 문장 중간에서 끊긴 원고는 손대지 않은 초안보다 낫지 않다.
test('한도에 걸린 응답은 길어도 버린다', () => {
  const long = GOOD + '태평양 항로의 선복 조절은 8월 중순부';
  assert.equal(pickRevision(DRAFT, long, 'max_tokens'), DRAFT);
});

test('절반 아래로 줄면 다듬은 것이 아니라 잃은 것이다', () => {
  assert.equal(pickRevision(DRAFT, DRAFT.slice(0, Math.floor(DRAFT.length * 0.4)), 'end_turn'), DRAFT);
});

// 검수는 대체로 조금 줄인다. 그 정도로 초안을 되돌리면 PASS 2가 무의미해진다.
test('정상적으로 끝난 검수는 채택한다', () => {
  assert.equal(pickRevision(DRAFT, GOOD, 'end_turn'), GOOD);
  const trimmed = DRAFT.slice(0, Math.floor(DRAFT.length * 0.8));
  assert.equal(pickRevision(DRAFT, trimmed, 'end_turn'), trimmed);
});

// PASS 1이 먼저 실패한 경우까지 여기서 감출 일은 아니다.
test('초안이 비어 있으면 지킬 것이 없다', () => {
  assert.equal(pickRevision('', GOOD, 'end_turn'), GOOD);
});
