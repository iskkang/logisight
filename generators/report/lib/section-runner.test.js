'use strict';
const test = require('node:test');
const assert = require('node:assert');

const { pickRevision, runSection } = require('./section-runner');

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

// PASS 1 이 thinking 만 내고 text 블록을 안 내면 초안이 없다. pickRevision 은 PASS 2 가
// 빌 때만 막았고 PASS 1 이 비는 쪽은 열려 있었다 —— 2026-11 ocean.md 가 그래서 LLM 의
// 되묻기("검수·수정할 원문을 입력해 주시면…")를 본문으로 싣고 발행 QA 에 걸렸다.
test('PASS 1 이 본문을 못 내면 섹션을 실패시킨다', async () => {
  const prevKey = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = 'test-key';
  const calls = [];
  const client = { messages: { create: async (req) => {
    calls.push(req);
    return {                                   // 사고가 예산을 다 씀 — text 블록 없음
      content: [{ type: 'thinking', thinking: '...' }],
      usage: { input_tokens: 1000, output_tokens: 16000 },
      stop_reason: 'max_tokens',
    };
  } } };
  try {
    await assert.rejects(
      () => runSection({
        client,
        sectionConfig: { id: 'ocean', title: '해운 시황', focus: '운임 동향' },
        items: [{ category: 'lane_causal', source: 'KSG', title: '운임 하락', url: 'https://example.com', summary: '요약' }],
        styleGuide: '스타일 가이드',
        month: '2026-11',
      }),
      /빈 초안/,
    );
    // PASS 2 는 부르지 않는다 —— 빈 원고를 던져 되묻기를 받아오는 길 자체를 막는다.
    assert.equal(calls.length, 1);
  } finally {
    if (prevKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = prevKey;
  }
});
