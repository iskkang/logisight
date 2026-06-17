'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildMessages } = require('./prompt');

test('system carries style rules; user injects signal facts + demands JSON', () => {
  const signals = [
    { label: '해상 운임 압력', state: 'caution', basis: 'KCCI 3주 평균 3,022 — 52주 백분위 75%, 직전 3주 평균比 +29.9%' },
    { label: '글로벌 운임 모멘텀', state: 'caution', basis: 'SCFI MoM +9.5% — WCI MoM +3.4%와 방향 정합' },
  ];
  const { system, messages } = buildMessages(signals, { asOf: '2026-06-15' });
  assert.match(system, /명사형 종결/);
  assert.match(system, /한자/);
  const u = messages[0].content;
  assert.match(u, /백분위 75%/);
  assert.match(u, /2026-06-15/);
  assert.match(u, /JSON/);
  assert.match(u, /"headline"/);
});
