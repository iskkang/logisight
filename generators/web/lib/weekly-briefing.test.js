'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { mondayOf, subtitleFor, buildSelectionMessages, toPoints } = require('./weekly-briefing.lib');

test('mondayOf: 목요일(KST) → 같은 주 월요일', () => {
  assert.equal(mondayOf(new Date('2026-06-11T03:00:00Z')), '2026-06-08');
});

test('mondayOf: 일요일 22:00 UTC = 월요일 07:00 KST → 그날(월) 반환', () => {
  assert.equal(mondayOf(new Date('2026-06-07T22:00:00Z')), '2026-06-08');
});

test('mondayOf: 월요일 00:30 KST(=일 15:30 UTC) → 그 월요일', () => {
  assert.equal(mondayOf(new Date('2026-06-07T15:30:00Z')), '2026-06-08');
});

test('subtitleFor: YYYY년 M월 W주 · 시황 · 기업 · 글로벌', () => {
  assert.equal(subtitleFor('2026-06-08'), '2026년 6월 2주 · 시황 · 기업 · 글로벌');
});

test('buildSelectionMessages: 기사 목록과 슬롯 지시가 프롬프트에 포함', () => {
  const msgs = buildSelectionMessages([
    { category: '해상', title: 'A운임 급등', summary: '4300弗' },
    { category: '물류', title: 'DSV 실적', summary: '매출 69%' },
  ]);
  assert.equal(msgs.length, 1);
  const text = msgs[0].content;
  assert.ok(text.includes('[해상] A운임 급등'));
  assert.ok(text.includes('[물류] DSV 실적'));
  assert.ok(text.includes('shipping'));
  assert.ok(text.includes('corp'));
  assert.ok(text.includes('brief'));
  assert.ok(text.includes('content'));
});

test('toPoints: 빈 슬롯 제외, display_order 시황1·기업2·글로벌3', () => {
  const points = toPoints('bid-1', { shipping: '시황 헤드', corp: '', brief: '글로벌 헤드' });
  assert.deepEqual(points, [
    { briefing_id: 'bid-1', agent_type: 'shipping', category: '시황', headline: '시황 헤드', display_order: 1 },
    { briefing_id: 'bid-1', agent_type: 'brief', category: '글로벌', headline: '글로벌 헤드', display_order: 3 },
  ]);
});

test('toPoints: 모든 슬롯 비면 빈 배열', () => {
  assert.deepEqual(toPoints('bid-1', { shipping: '', corp: '', brief: '' }), []);
  assert.deepEqual(toPoints('bid-1', {}), []);
});
