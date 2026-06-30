'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { mapEventRow, publishDecisionEvent } = require('./row');

const asof = new Date('2026-06-30T00:00:00Z');
const baseCtx = {
  event: { id: 'e1', name: 'Flood Warning', title: 'Flood Warning (NJ)', kind: 'flood', severity: 'r', area: 'NJ' },
  linkedAssets: [{ name: 'NY/NJ Inland (intermodal)', type: 'inland', km: 5, risk: null }],
  linkedRoutes: [],
};
const goodProse = { weather: 'w', impact: 'i', action: 'a', needs_editor: false };

test('가드 통과+자산 귀속 → published', () => {
  const row = mapEventRow(baseCtx, goodProse, asof);
  assert.equal(row.module, 'climate');
  assert.equal(row.metric_ref, 'climate:event:e1');
  assert.equal(row.status, 'published');
  assert.ok(row.published_at);
  assert.ok(row.data_quality_flags.includes('auto_published'));
});
test('needs_editor → draft 보류(auto_held)', () => {
  const row = mapEventRow(baseCtx, { weather: null, impact: null, action: null, needs_editor: true }, asof);
  assert.equal(row.status, 'draft');
  assert.ok(row.data_quality_flags.some((f) => f.startsWith('auto_held')));
});
test('연관 자산/노선 없음 → 보류', () => {
  const d = publishDecisionEvent({ ...baseCtx, linkedAssets: [], linkedRoutes: [] }, goodProse);
  assert.equal(d.publish, false);
});
