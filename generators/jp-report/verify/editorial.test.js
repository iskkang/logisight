'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseVerdict, buildIssueFeedback, needsRewrite, isBlocking, splitBySeverity } = require('./editorial');

// 문체 지적만 남았다고 영구히 발행을 막으면 파이프라인이 자동으로 돌지 못한다.
// 사실관계 위반은 막고, 문체는 기록만 한다.
test('isBlocking: 사실관계 위반은 발행을 막는다', () => {
  assert.equal(isBlocking('speculation'), true);
  assert.equal(isBlocking('unsupported_fact'), true);
  assert.equal(isBlocking('gap_violation'), true);
  assert.equal(isBlocking('period_not_disclosed'), true);
});

test('isBlocking: 문체·기타는 막지 않는다', () => {
  assert.equal(isBlocking('style'), false);
  assert.equal(isBlocking('other'), false);
  assert.equal(isBlocking('missing_signal'), false);
});

test('splitBySeverity: 차단·경고로 나눈다', () => {
  const { blocking, warnings } = splitBySeverity([
    { type: 'speculation', quote: 'a', reason: 'r1' },
    { type: 'style', quote: 'b', reason: 'r2' },
  ]);
  assert.equal(blocking.length, 1);
  assert.equal(warnings.length, 1);
  assert.equal(blocking[0].type, 'speculation');
});

test('splitBySeverity: 빈 입력', () => {
  const { blocking, warnings } = splitBySeverity([]);
  assert.deepEqual(blocking, []);
  assert.deepEqual(warnings, []);
});

test('parseVerdict: 정상 판정을 그대로 통과', () => {
  const v = parseVerdict({ verdict: 'PASS', issues: [] });
  assert.equal(v.verdict, 'PASS');
  assert.deepEqual(v.issues, []);
});

test('parseVerdict: 소문자·공백 판정을 정규화', () => {
  assert.equal(parseVerdict({ verdict: ' revise ', issues: [] }).verdict, 'REVISE');
});

// 판정을 못 읽으면 통과시켜선 안 된다. 자동 발행이라 사람이 보지 않는다.
test('parseVerdict: 알 수 없는 판정은 REVISE로 떨어뜨린다', () => {
  assert.equal(parseVerdict({ verdict: 'MAYBE' }).verdict, 'REVISE');
  assert.equal(parseVerdict({}).verdict, 'REVISE');
  assert.equal(parseVerdict(null).verdict, 'REVISE');
});

test('parseVerdict: issues 형식을 정리하고 빈 항목은 버린다', () => {
  const v = parseVerdict({
    verdict: 'REVISE',
    issues: [
      { type: 'speculation', quote: '可能性がある', reason: '推測' },
      { quote: '' },
      'ゴミ',
    ],
  });
  assert.equal(v.issues.length, 1);
  assert.equal(v.issues[0].type, 'speculation');
});

// PASS인데 지적이 달려 오는 경우가 있다. 지적이 있으면 통과시키지 않는다.
test('parseVerdict: PASS인데 지적이 있으면 REVISE', () => {
  const v = parseVerdict({ verdict: 'PASS', issues: [{ type: 'speculation', quote: 'x', reason: 'y' }] });
  assert.equal(v.verdict, 'REVISE');
});

test('needsRewrite: REVISE·REJECT만 재작성 대상', () => {
  assert.equal(needsRewrite('PASS'), false);
  assert.equal(needsRewrite('REVISE'), true);
  assert.equal(needsRewrite('REJECT'), true);
});

test('buildIssueFeedback: 인용과 이유를 함께 담는다 — 지시가 구체적이어야 한다', () => {
  const fb = buildIssueFeedback([
    { type: 'speculation', quote: '進んでいる可能性がある', reason: '根拠がない' },
    { type: 'missing_signal', quote: '', reason: '契約通貨98.1に触れていない' },
  ]);
  assert.ok(fb.includes('進んでいる可能性がある'));
  assert.ok(fb.includes('根拠がない'));
  assert.ok(fb.includes('契約通貨98.1'));
});

test('buildIssueFeedback: 지적이 없으면 빈 문자열', () => {
  assert.equal(buildIssueFeedback([]), '');
});
