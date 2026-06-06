'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildBlankSailing,
  tagBlankSailingNews,
  aggregateNewsDerived,
} = require('./blank-sailing');

const asof = new Date('2026-06-05T00:00:00Z');

test('rising blank_pct → expanding, ratio carried, tracker_quoted', () => {
  const rows = [
    { week_start: '2026-06-01', blank_pct: 12, source: 'Drewry' },
    { week_start: '2026-05-25', blank_pct: 8, source: 'Drewry' },
  ];
  const bs = buildBlankSailing(rows, asof);
  assert.equal(bs.source_type, 'tracker_quoted');
  assert.equal(bs.ratio_pct, 12);
  assert.equal(bs.direction, 'expanding');
  assert.equal(bs.magnitude_class, 'moderate'); // 7..15
  assert.equal(bs.geo_scope, 'trade_level_proxy');
  assert.equal(bs.signal_age_days, 4);
});
test('falling blank_pct → easing; >=15 major', () => {
  const rows = [
    { week_start: '2026-06-01', blank_pct: 16 },
    { week_start: '2026-05-25', blank_pct: 20 },
  ];
  const bs = buildBlankSailing(rows, asof);
  assert.equal(bs.direction, 'easing');
  assert.equal(bs.magnitude_class, 'major');
});
test('flat (±1pp) → stable', () => {
  const bs = buildBlankSailing([{ week_start: '2026-06-01', blank_pct: 6 }, { week_start: '2026-05-25', blank_pct: 6.5 }], asof);
  assert.equal(bs.direction, 'stable');
  assert.equal(bs.magnitude_class, 'minor');
});
test('no rows → source_type none', () => {
  assert.equal(buildBlankSailing([], asof).source_type, 'none');
});
test('tracker output carries evidence [{source,published,claim}]', () => {
  const bs = buildBlankSailing([{ week_start: '2026-06-01', blank_pct: 12, source: 'Drewry' }], asof);
  assert.ok(Array.isArray(bs.evidence) && bs.evidence.length >= 1);
  assert.equal(bs.evidence[0].source, 'Drewry');
  assert.match(bs.evidence[0].claim, /12%/);
});

test('tagBlankSailingNews: keeps only 결항-keyword articles', () => {
  const news = [
    { title: 'Maersk announces blank sailing on transpacific', summary: '' },
    { title: '아시아-유럽 임시결항 확대', summary: '' },
    { title: 'Port of LA throughput up 3%', summary: '' },
  ];
  const tagged = tagBlankSailingNews(news);
  assert.equal(tagged.length, 2);
});

test('aggregateNewsDerived: direction vote + independent_sources + 14d expiry', () => {
  const signals = [
    { trade: 'transpacific', direction: 'expanding', magnitude_class: 'major', data_origin: 'Drewry', published: '2026-06-01' },
    { trade: 'transpacific', direction: 'expanding', magnitude_class: 'moderate', data_origin: 'Sea-Intelligence', published: '2026-05-30' },
    { trade: 'asia_europe', direction: 'easing', magnitude_class: 'minor', data_origin: 'Drewry', published: '2026-03-01' }, // 만료
  ];
  const d = aggregateNewsDerived(signals, asof);
  assert.equal(d.source_type, 'news_derived');
  assert.equal(d.direction, 'expanding'); // 만료분 제외 → 2 expanding
  assert.equal(d.magnitude_class, 'major');
  assert.equal(d.independent_sources, 2); // Drewry + Sea-Intelligence
  assert.equal(d.geo_scope, 'trade_level_proxy');
});
test('aggregateNewsDerived: all expired → none', () => {
  const signals = [{ direction: 'expanding', magnitude_class: 'major', data_origin: 'X', published: '2026-01-01' }];
  assert.equal(aggregateNewsDerived(signals, asof).source_type, 'none');
});
