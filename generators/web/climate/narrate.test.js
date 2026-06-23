'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildClimatePrompt, validateClimate, narrateClimate } = require('./narrate');

const ctx = {
  asof: new Date('2026-06-23T00:00:00Z'),
  event: { id: 'hko-2611', kind: 'cyclone', title: 'MEKKHALA (Super Typhoon)', name: 'MEKKHALA', severity: 'r', lon: 125.6, lat: 18.5, area: '북서태평양' },
  route: { id: 'r3', name: '아시아–미동안' },
  viaPassage: { id: 'miyako_strait', name_ko: '미야코해협' },
  viaMinKm: 100,
  sharedRoutes: [{ id: 'r1', name: '아시아–유럽' }],
  trackSummary: { current: [125.2, 18.9], via: [125.3, 24.7], end: [145.8, 36.9], direction: '북동진', points: 121, hasTrack: true },
  nearbyAssets: [],
};

const GOOD = {
  weather: 'MEKKHALA는 슈퍼태풍 강도로 현재 남쪽 해상에 위치하며, 예보트랙은 북동진하여 미야코해협을 통과하는 것으로 나타났다. 트랙 점에 예보시각이 없어 통과 시점은 단정하지 않는다.',
  impact: '아시아–미동안 노선이 미야코해협을 지나므로 해당 구간 통항·리드타임에 지연 가능성이 있다고 추정된다. 정량 근거가 없어 +2~4일가량 추정 수준으로만 본다.',
  action: '미야코해협 경유 부킹에 버퍼를 두고 트랙 갱신을 모니터링할 것을 권고한다.',
  event_echo: 'MEKKHALA',
};

test('buildClimatePrompt: 시스템에 신호가중·환각차단·트랙시각 가드 포함', () => {
  const { system } = buildClimatePrompt(ctx);
  assert.match(system, /평시/);          // asset_risk 평시-only 가중
  assert.match(system, /활성 이벤트/);
  assert.match(system, /입력.*없는/);    // 환각 차단(입력에 없는 노선·항만·수치 금지)
  assert.match(system, /트랙/);          // 트랙 기반 서술
  assert.match(system, /시각|시점/);     // 예보시각 없으니 +N일 만들지 말 것
});

test('buildClimatePrompt: user에 via_passage·route·트랙 방향 포함(거리근접 아님)', () => {
  const { user } = buildClimatePrompt(ctx);
  assert.match(user, /MEKKHALA/);
  assert.match(user, /아시아–미동안/);
  assert.match(user, /미야코해협/);      // 걸린 관문
  assert.match(user, /북동진/);          // 트랙 방향
});

test('buildClimatePrompt: 점 이벤트(트랙 없음)도 via_passage 기반으로 구성', () => {
  const pt = { ...ctx, event: { ...ctx.event, kind: 'flood', name: 'FloodX' }, trackSummary: { current: [125, 24], hasTrack: false } };
  const { user } = buildClimatePrompt(pt);
  assert.match(user, /미야코해협/);
});

test('validateClimate: 정상 3단 출력 통과', () => {
  assert.deepEqual(validateClimate(GOOD, ctx), { ok: true, issues: [] });
});

test('validateClimate: 단정 표현(반드시) 차단', () => {
  assert.equal(validateClimate({ ...GOOD, impact: '반드시 지연된다는 추정이 가능하다.' }, ctx).ok, false);
});

test('validateClimate: 추정표현 없는 지연일 차단', () => {
  const v = validateClimate({ ...GOOD, impact: '리드타임이 +3일 늘어난다.' }, ctx);
  assert.equal(v.ok, false);
  assert.ok(v.issues.some((i) => /추정/.test(i)));
});

test('validateClimate: 이벤트 echo 불일치 차단', () => {
  assert.equal(validateClimate({ ...GOOD, event_echo: 'HAIKUI' }, ctx).ok, false);
});

test('narrateClimate: 검증 통과 시 3단 필드 반환', async () => {
  const out = await narrateClimate(async () => JSON.stringify(GOOD), ctx);
  assert.equal(out.needs_editor, false);
  assert.equal(out.weather, GOOD.weather);
});

test('narrateClimate: 검증 실패 반복 시 needs_editor=true', async () => {
  const out = await narrateClimate(async () => 'not json', ctx, { maxRetries: 1 });
  assert.equal(out.needs_editor, true);
  assert.equal(out.weather, null);
});
