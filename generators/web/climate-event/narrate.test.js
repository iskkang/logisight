'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { narrateEventImpact, buildEventPrompt } = require('./narrate');

const ctx = {
  asof: new Date('2026-06-30T00:00:00Z'),
  event: { name: 'Flood Warning', title: 'Flood Warning (NJ)', kind: 'flood', severity: 'r', lon: -74.17, lat: 40.73, area: 'NJ', track: null },
  linkedAssets: [{ name: 'NY/NJ Inland (intermodal)', type: 'inland', km: 5, risk: null }],
  linkedRoutes: [],
  gazetteer: ['NY/NJ Inland (intermodal)'],
  allowedPlaces: new Set(['NY/NJ Inland (intermodal)', 'NJ']),
};
const good = JSON.stringify({ weather: '홍수 경보가 인근에 발효됐다. 강수로 침수 가능성이 있다고 추정된다.', impact: '내륙 통관 후 철도 연결 리드타임 +1~2일가량 지연 가능성이 있다고 추정된다.', action: '해당 거점 경유 화물의 ETA 버퍼 확보를 권고한다.', event_echo: 'Flood Warning' });

test('유효 JSON → needs_editor=false', async () => {
  const r = await narrateEventImpact(async () => good, ctx);
  assert.equal(r.needs_editor, false);
  assert.match(r.impact, /추정/);
});
test('단정 표현 → needs_editor=true', async () => {
  const bad = JSON.stringify({ weather: '반드시 침수된다', impact: '반드시 지연된다', action: 'x', event_echo: 'Flood Warning' });
  const r = await narrateEventImpact(async () => bad, ctx, { maxRetries: 0 });
  assert.equal(r.needs_editor, true);
});
test('프롬프트에 연관 자산명이 들어간다', () => {
  const { user } = buildEventPrompt(ctx);
  assert.match(user, /NY\/NJ Inland/);
});
