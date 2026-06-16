'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildMessages } = require('./prompt');

const wd = {
  weekId: '2026-W24', period: { start: '06/08', end: '06/14' },
  sections: [
    { id: 'ocean', title: '2. 해상', table: '| 지수 |...|', factText: '출처: freight_indices',
      news: [{ title: 'Container freight rates continue march northwards', source: 'Seatrade' }] },
  ],
};
test('system prompt carries style + signal rules', () => {
  const { system } = buildMessages(wd);
  assert.match(system, /명사형 종결/);
  assert.match(system, /🟢|신호등/);
});
test('user message injects week, tables, and news candidates; demands JSON', () => {
  const { messages } = buildMessages(wd);
  const u = messages[0].content;
  assert.match(u, /2026-W24/);
  assert.match(u, /Container freight rates/);
  assert.match(u, /JSON/);
});
