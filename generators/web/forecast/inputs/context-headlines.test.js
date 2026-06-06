'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildContextHeadlines } = require('./context-headlines');

const news = [
  { title: 'Red Sea diversions extend Asia-Europe transit', summary: '', source: 'Loadstar', published_at: '2026-06-05' },
  { title: 'Transpacific spot rates climb on US demand', summary: '', source: 'Splash247', published_at: '2026-06-04' },
  { title: 'Port of Busan throughput steady', summary: '', source: 'X', published_at: '2026-06-03' },
];

test('EU region: keeps Red Sea / Europe headlines', () => {
  const r = buildContextHeadlines(news, { dest: '함부르크' }, 'EU');
  assert.ok(r.some((h) => /Red Sea/.test(h.title)));
  assert.equal(r.every((h) => 'title' in h && 'source' in h && 'published' in h), true);
});
test('미주 region: keeps transpacific/US headlines', () => {
  const r = buildContextHeadlines(news, { dest: '로스앤젤레스' }, '미주');
  assert.ok(r.some((h) => /Transpacific/.test(h.title)));
});
test('no region match → fallback to recent (non-empty), capped 8', () => {
  const many = Array.from({ length: 12 }, (_, i) => ({ title: `news ${i}`, source: 's', published_at: '2026-06-01' }));
  const r = buildContextHeadlines(many, { dest: '없음' }, null);
  assert.equal(r.length, 8);
});
test('empty news → empty list', () => {
  assert.deepEqual(buildContextHeadlines([], { dest: 'x' }, 'EU'), []);
});
