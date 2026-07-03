'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeMaritimeRow, dedupeByUrl, rankAndCap } = require('./maritime-news-feed');

test('normalizeMaritimeRow: summary→summary_en 매핑, category/section null', () => {
  const row = {
    title: 'Rates surge on Asia-Europe',
    summary: 'Spot rates jumped 12%',
    content: 'Long body text...',
    source: 'The Loadstar',
    url: 'https://x/1',
    published_at: '2026-06-20T00:00:00Z',
    category: '해상',
    agent_type: 'external',
  };
  const it = normalizeMaritimeRow(row);
  assert.equal(it.title, 'Rates surge on Asia-Europe');
  assert.equal(it.summary_en, 'Spot rates jumped 12%');
  assert.equal(it.content, 'Long body text...');
  assert.equal(it.source, 'The Loadstar');
  assert.equal(it.url, 'https://x/1');
  assert.equal(it.published_at, '2026-06-20T00:00:00Z');
  assert.equal(it.category, null);
  assert.equal(it.section, null);
});

test('normalizeMaritimeRow: summary 없으면 summary_en 빈 문자열', () => {
  const it = normalizeMaritimeRow({ title: 'T', url: 'u', source: 's' });
  assert.equal(it.summary_en, '');
  assert.equal(it.content, '');
});

test('dedupeByUrl: 같은 url 첫 등장만 유지', () => {
  const items = [
    { url: 'https://a', title: '1' },
    { url: 'https://a', title: '2' },
    { url: 'https://b', title: '3' },
  ];
  const out = dedupeByUrl(items);
  assert.equal(out.length, 2);
  assert.deepEqual(out.map(i => i.title), ['1', '3']);
});

test('dedupeByUrl: url 없는 항목은 모두 유지', () => {
  const items = [{ title: 'x' }, { title: 'y' }];
  assert.equal(dedupeByUrl(items).length, 2);
});

test('rankAndCap: 최신순 정렬 + cap 적용', () => {
  const items = [
    { title: 'old', published_at: '2026-06-01', summary_en: 'aa', content: '' },
    { title: 'new', published_at: '2026-06-25', summary_en: 'a', content: '' },
    { title: 'mid', published_at: '2026-06-10', summary_en: 'a', content: '' },
  ];
  const out = rankAndCap(items, 2);
  assert.equal(out.length, 2);
  assert.deepEqual(out.map(i => i.title), ['new', 'mid']);
});

test('rankAndCap: 동일 날짜면 분량 긴 것 우선', () => {
  const items = [
    { title: 'short', published_at: '2026-06-10', summary_en: 'a', content: '' },
    { title: 'long',  published_at: '2026-06-10', summary_en: 'a', content: 'xxxxxxxxxx' },
  ];
  const out = rankAndCap(items, 2);
  assert.deepEqual(out.map(i => i.title), ['long', 'short']);
});

test('rankAndCap: cap이 항목 수보다 크면 전부 반환', () => {
  const items = [{ title: 'a', published_at: '2026-06-01', summary_en: '', content: '' }];
  assert.equal(rankAndCap(items, 40).length, 1);
});
