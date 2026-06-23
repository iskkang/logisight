'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { mapClimateRow, EDITOR_PLACEHOLDER } = require('./row');

const asof = new Date('2026-06-23T00:00:00Z');
const ctx = {
  asof,
  event: { id: 'hko-2611', title: 'MEKKHALA (Super Typhoon)', name: 'MEKKHALA', kind: 'cyclone', severity: 'r', lon: 125.6, lat: 18.5, area: '북서태평양' },
  route: { id: 'r3', name: '아시아–미동안' },
  nearestKm: 878,
  nearestLabel: '대만 해협',
  nearbyAssets: [{ name: '대만 해협', type: 'choke', km: 878, risk: { score: 0, level: 'g', driver: '평온' } }],
};
const prose = { weather: '강도 슈퍼태풍 …', impact: '리드타임 +2~4일가량 추정 …', action: '버퍼 확보 권고', needs_editor: false };

test('mapClimateRow: module=climate, status=draft(항상), 미발행', () => {
  const r = mapClimateRow(ctx, prose, asof);
  assert.equal(r.module, 'climate');
  assert.equal(r.status, 'draft');
  assert.equal(r.published_at, null);
});

test('mapClimateRow: 연결 키 metric_ref = climate:<route>:<event>', () => {
  assert.equal(mapClimateRow(ctx, prose, asof).metric_ref, 'climate:r3:hko-2611');
});

test('mapClimateRow: statement는 3단(기상/영향) 라벨 포함, impact_note는 권장행동', () => {
  const r = mapClimateRow(ctx, prose, asof);
  assert.match(r.statement, /기상 리스크 변화/);
  assert.match(r.statement, /영향/);
  assert.ok(r.statement.includes(prose.weather));
  assert.ok(r.statement.includes(prose.impact));
  assert.ok(r.impact_note.includes(prose.action));
});

test('mapClimateRow: horizon_date = 기준일 + 3일(valid_at)', () => {
  assert.equal(mapClimateRow(ctx, prose, asof).horizon_date, '2026-06-26');
});

test('mapClimateRow: 경보(red)+태풍 → confidence medium', () => {
  assert.equal(mapClimateRow(ctx, prose, asof).confidence, 'medium');
});

test('mapClimateRow: 주의(orange)·비태풍 → confidence low', () => {
  const c2 = { ...ctx, event: { ...ctx.event, severity: 'a', kind: 'flood', name: 'FloodX' } };
  assert.equal(mapClimateRow(c2, prose, asof).confidence, 'low');
});

test('mapClimateRow: basis·model_version·confidence_reason 채움', () => {
  const r = mapClimateRow(ctx, prose, asof);
  assert.ok(Array.isArray(r.basis) && r.basis.length >= 2);
  assert.ok(r.basis.some((b) => b.includes('MEKKHALA')));
  assert.ok(r.basis.some((b) => b.includes('대만 해협')));
  assert.equal(r.model_version, 'climate-v1');
  assert.match(r.confidence_reason, /에디터 검수/);
});

test('mapClimateRow: 예보경로 미보유는 data_quality_flags에 기록', () => {
  const r = mapClimateRow(ctx, prose, asof);
  assert.ok((r.data_quality_flags || []).some((f) => /경로|track/i.test(f)));
});

test('mapClimateRow: needs_editor면 본문 placeholder·impact_note null, 여전히 draft', () => {
  const r = mapClimateRow(ctx, { needs_editor: true }, asof);
  assert.equal(r.statement, EDITOR_PLACEHOLDER);
  assert.equal(r.impact_note, null);
  assert.equal(r.status, 'draft');
});
