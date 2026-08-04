'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { flagJa, flagsFor } = require('./flags');

// 플래그 '값'이 한국어라 모델이 '결측'을 「結測」으로 음차했다(일본어에 없는 말).
// 발행분 4건이 전부 그렇게 나왔고, 삭제 후 재생성해야 했다.

test('flagJa: 결측 플래그를 옮긴다', () => {
  assert.equal(flagJa('cost: 결측 — 가중치 재분배'), 'cost: 欠測 — 加重を再配分');
  assert.equal(flagJa('pricing: 결측 — 가중치 재분배'), 'pricing: 欠測 — 加重を再配分');
});

test('flagJa: 근사·관측1건 플래그를 옮긴다', () => {
  assert.equal(flagJa('비용: 유가 비교 구간 12일(월간 미만, 근사)'), 'コスト: 燃料油の比較期間 12日(1か月未満・近似)');
  assert.equal(flagJa('공급: 방향 미산출(관측 1건) — 기본값 stable'), '供給: 方向を算出せず(観測1件) — 既定値 stable');
});

// '한국 수출'을 그대로 옮기면 일본 독자에게 뜻이 없다. 무엇이 없는지만 남긴다.
test('flagJa: 한국 전용 문구는 뜻만 남긴다', () => {
  const out = flagJa('수요: 한국 수출 비적용(상하이발 등 지리 불일치) — 모멘텀 결측');
  assert.ok(out.includes('欠測'));
  assert.ok(!/한국|[가-힣]/.test(out), out);
});

// 지우면 무슨 결측인지 알 수 없게 된다.
test('flagJa: 모르는 플래그는 원문 그대로', () => {
  assert.equal(flagJa('알 수 없는 신호'), '알 수 없는 신호');
});

test('flagsFor: ko는 그대로, ja만 옮긴다', () => {
  const f = ['cost: 결측 — 가중치 재분배'];
  assert.deepEqual(flagsFor(f, 'ko'), f);
  assert.deepEqual(flagsFor(f, 'ja'), ['cost: 欠測 — 加重を再配分']);
  assert.deepEqual(flagsFor(null, 'ja'), []);
});

// 옮긴 결과에 한글이 남으면 화면과 프롬프트 양쪽으로 샌다.
test('flagsFor(ja): 알려진 플래그에 한글이 남지 않는다', () => {
  const all = [
    'cost: 결측 — 가중치 재분배',
    '비용: 유가 비교 구간 12일(월간 미만, 근사)',
    '공급: 방향 미산출(관측 1건) — 기본값 stable',
    '수요: 한국 수출 비적용(상하이발 등 지리 불일치) — 모멘텀 결측',
  ];
  for (const s of flagsFor(all, 'ja')) assert.ok(!/[가-힣]/.test(s), s);
});
