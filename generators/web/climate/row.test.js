'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { mapClimateRow, EDITOR_PLACEHOLDER } = require('./row');

const asof = new Date('2026-06-23T00:00:00Z');
const base = {
  asof,
  route: { id: 'r3', name: '아시아–미동안' },
  viaPassage: { id: 'miyako_strait', name_ko: '미야코해협', lat: 24.8, lon: 125.3 },
  viaMinKm: 100,
  sharedRoutes: [],
  trackSummary: { current: [125.2, 18.9], via: [125.3, 24.7], end: [145.8, 36.9], direction: '북동진', points: 121, hasTrack: true },
  nearbyAssets: [],
};
const critical = { ...base, event: { id: 'hko-2611', kind: 'cyclone', title: 'MEKKHALA (Super Typhoon)', name: 'MEKKHALA', severity: 'r', lon: 125.6, lat: 18.5 } };
const warning = { ...base, event: { id: 'hko-9', kind: 'cyclone', title: 'STORMX (Tropical Storm)', name: 'STORMX', severity: 'a', lon: 125, lat: 22 } };
const prose = { weather: '슈퍼태풍 미야코해협 통과 …', impact: '리드타임 +2~4일가량 추정 …', action: '버퍼 확보 권고', needs_editor: false };

test('전량 자동: CRITICAL(태풍 red)도 가드 통과 시 자동발행(published)', () => {
  const r = mapClimateRow(critical, prose, asof);
  assert.equal(r.status, 'published');
  assert.equal(r.published_at, asof.toISOString());
  assert.ok(r.data_quality_flags.includes('auto_published'));
  assert.ok(!r.data_quality_flags.some((f) => /^hold:/.test(f)));
});

test('전량 자동: WARNING(a) + 가드 통과 → published', () => {
  assert.equal(mapClimateRow(warning, prose, asof).status, 'published');
});

test('보류: 가드 실패(needs_editor) → draft + hold:guard_fail, placeholder', () => {
  const r = mapClimateRow(critical, { needs_editor: true }, asof);
  assert.equal(r.status, 'draft');
  assert.equal(r.published_at, null);
  assert.equal(r.statement, EDITOR_PLACEHOLDER);
  assert.equal(r.impact_note, null);
  assert.ok(r.data_quality_flags.includes('auto_held'));
  assert.ok(r.data_quality_flags.includes('hold:guard_fail'));
});

test('보류: 귀속 불명(via/route 누락) → draft + hold:no_attribution', () => {
  const noAttr = { ...critical, viaPassage: { id: '', name_ko: '' } };
  const r = mapClimateRow(noAttr, prose, asof);
  assert.equal(r.status, 'draft');
  assert.ok(r.data_quality_flags.includes('hold:no_attribution'));
});

test('flags: gate_version 기록', () => {
  assert.ok(mapClimateRow(critical, prose, asof).data_quality_flags.some((f) => /^gate:climate-gate-v/.test(f)));
});

test('연결 키 metric_ref = climate:<route>:<event>:<via>', () => {
  assert.equal(mapClimateRow(critical, prose, asof).metric_ref, 'climate:r3:hko-2611:miyako_strait');
});

test('statement 3단·impact_note 권장행동(발행분)', () => {
  const r = mapClimateRow(warning, prose, asof);
  assert.match(r.statement, /기상 리스크 변화/);
  assert.ok(r.impact_note.includes(prose.action));
});

test('basis에 걸린 관문·트랙 교차 명시', () => {
  const b = mapClimateRow(critical, prose, asof).basis;
  assert.ok(b.some((x) => x.includes('미야코해협') && /트랙|교차/.test(x)));
});

test('confidence_reason: 발행분=자동발행, 보류분=보류 사유', () => {
  assert.match(mapClimateRow(critical, prose, asof).confidence_reason, /자동발행/);
  assert.match(mapClimateRow(critical, { needs_editor: true }, asof).confidence_reason, /보류|guard_fail/);
});

test('horizon_date = 기준일 + 3일', () => {
  assert.equal(mapClimateRow(critical, prose, asof).horizon_date, '2026-06-26');
});
