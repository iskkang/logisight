'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { mapClimateRow, EDITOR_PLACEHOLDER } = require('./row');

const asof = new Date('2026-06-23T00:00:00Z');
const ctx = {
  asof,
  event: { id: 'hko-2611', kind: 'cyclone', title: 'MEKKHALA (Super Typhoon)', name: 'MEKKHALA', severity: 'r', lon: 125.6, lat: 18.5 },
  route: { id: 'r3', name: '아시아–미동안' },
  viaPassage: { id: 'miyako_strait', name_ko: '미야코해협', lat: 24.8, lon: 125.3 },
  viaMinKm: 100,
  sharedRoutes: [{ id: 'r1', name: '아시아–유럽' }],
  trackSummary: { current: [125.2, 18.9], via: [125.3, 24.7], end: [145.8, 36.9], direction: '북동진', points: 121, hasTrack: true },
  nearbyAssets: [],
};
const prose = { weather: '강도 슈퍼태풍, 미야코해협 통과 …', impact: '리드타임 +2~4일가량 추정 …', action: '버퍼 확보 권고', needs_editor: false };

test('mapClimateRow: 연결 키 metric_ref = climate:<route>:<event>:<via_passage>', () => {
  assert.equal(mapClimateRow(ctx, prose, asof).metric_ref, 'climate:r3:hko-2611:miyako_strait');
});

test('mapClimateRow: module=climate, status=draft(항상), 미발행', () => {
  const r = mapClimateRow(ctx, prose, asof);
  assert.equal(r.module, 'climate');
  assert.equal(r.status, 'draft');
  assert.equal(r.published_at, null);
});

test('mapClimateRow: statement 3단(기상/영향), impact_note 권장행동', () => {
  const r = mapClimateRow(ctx, prose, asof);
  assert.match(r.statement, /기상 리스크 변화/);
  assert.match(r.statement, /영향/);
  assert.ok(r.statement.includes(prose.weather));
  assert.ok(r.impact_note.includes(prose.action));
});

test('mapClimateRow: basis에 걸린 관문(via_passage)·트랙 교차·거리 명시', () => {
  const b = mapClimateRow(ctx, prose, asof).basis;
  assert.ok(b.some((x) => x.includes('미야코해협') && /트랙|교차/.test(x)));
  assert.ok(b.some((x) => x.includes('MEKKHALA')));
});

test('mapClimateRow: confidence_reason에 via 통과→route 전파 사유', () => {
  const r = mapClimateRow(ctx, prose, asof);
  assert.match(r.confidence_reason, /미야코해협/);
  assert.match(r.confidence_reason, /교차|전파/);
});

test('mapClimateRow: 경보(red)+태풍 → confidence medium', () => {
  assert.equal(mapClimateRow(ctx, prose, asof).confidence, 'medium');
});

test('mapClimateRow: horizon_date = 기준일 + 3일', () => {
  assert.equal(mapClimateRow(ctx, prose, asof).horizon_date, '2026-06-26');
});

test('mapClimateRow: needs_editor면 placeholder·impact_note null, 여전히 draft', () => {
  const r = mapClimateRow(ctx, { needs_editor: true }, asof);
  assert.equal(r.statement, EDITOR_PLACEHOLDER);
  assert.equal(r.impact_note, null);
  assert.equal(r.status, 'draft');
});
