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

// ── 언어 축 ─────────────────────────────────────────────────────────────
// 산문만 일본어로 바꾸고 마커를 두면 화면에 '[기상 리스크 변화]'가 남는다.
// 마커는 일본판 화면(fcSections·fcAction)이 그대로 잘라내는 문자열이라 값이 맞아야 한다.
const jaProse = { weather: '台風は宮古海峡の東にある。', impact: '遅延の可能性がある。', action: '出港時期を調整する。', needs_editor: false };
const jaCtx = {
  event: { id: 'ev-1', title: 'Typhoon MAWAR', name: 'MAWAR', kind: 'cyclone', severity: 'r' },
  linkedAssets: [{ name: '東京港', type: 'port', km: 40 }],
  linkedRoutes: [],
};

test('mapEventRow(ja): 본문 마커가 일본어이고 lang이 붙는다', () => {
  const row = mapEventRow(jaCtx, jaProse, new Date('2026-06-30'), 'ja');
  assert.equal(row.lang, 'ja');
  assert.ok(row.statement.startsWith('[気象リスクの変化]'));
  assert.ok(row.statement.includes('[影響]'));
  assert.ok(row.impact_note.startsWith('[推奨アクション]'));
  assert.ok(!/[가-힣]/.test(row.statement), `본문에 한글: ${row.statement}`);
  assert.ok(!/[가-힣]/.test(row.impact_note));
});

test('mapEventRow(ja): 지진은 종류별 머리말을 쓴다', () => {
  const ctx = { ...jaCtx, event: { ...jaCtx.event, kind: 'earthquake' } };
  assert.ok(mapEventRow(ctx, jaProse, new Date('2026-06-30'), 'ja').statement.startsWith('[地震の状況]'));
});

test('mapEventRow: lang 기본값은 ko — 기존 호출부가 그대로 동작한다', () => {
  const row = mapEventRow(jaCtx, jaProse, new Date('2026-06-30'));
  assert.equal(row.lang, 'ko');
  assert.ok(row.statement.startsWith('[기상 리스크 변화]'));
});
