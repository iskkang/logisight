'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { filterNews } = require('./news-filter');

const now = new Date('2026-06-14T00:00:00Z');
const items = [
  { title: 'Container freight rates continue march northwards', source: 'Seatrade', url: 'u1', published_at: '2026-06-12T00:00:00Z' },
  { title: 'Old rate news', source: 'X', url: 'u2', published_at: '2026-05-01T00:00:00Z' },
  { title: 'Container freight rates continue march northwards', source: 'Seatrade', url: 'u3', published_at: '2026-06-12T00:00:00Z' },
  { title: 'Random offshore wind story', source: 'Y', url: 'u4', published_at: '2026-06-13T00:00:00Z' },
];
test('keeps recent, keyword-matching, title-deduped items', () => {
  const out = filterNews(items, ['freight', 'rate'], now, 7);
  assert.equal(out.length, 1);
  assert.equal(out[0].url, 'u1');
});
test('limit caps results', () => {
  const many = Array.from({ length: 10 }, (_, i) =>
    ({ title: `freight story ${i}`, source: 'S', url: `u${i}`, published_at: '2026-06-12T00:00:00Z' }));
  assert.equal(filterNews(many, ['freight'], now, 7, 3).length, 3);
});
