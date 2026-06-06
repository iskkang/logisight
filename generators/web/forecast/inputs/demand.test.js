'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { exportMomentum, frontloadingFlag, buildDemand } = require('./demand');

const asof = new Date('2026-06-05T00:00:00Z');

test('exportMomentum: YoY from period totals', () => {
  const totals = [
    { period: '2026-05', total: 110 },
    { period: '2025-05', total: 100 },
  ];
  const r = exportMomentum(totals);
  assert.equal(r.yoy_pct, 10);
});
test('exportMomentum: no prior-year match → null', () => {
  assert.equal(exportMomentum([{ period: '2026-05', total: 110 }]).yoy_pct, null);
});

test('frontloadingFlag: policy effective within 60d → true', () => {
  assert.equal(frontloadingFlag([{ effective_date: '2026-07-01' }], asof), true);
});
test('frontloadingFlag: nothing imminent → false', () => {
  assert.equal(frontloadingFlag([{ effective_date: '2026-12-01' }], asof), false);
});

test('buildDemand: combines momentum + seasonality + frontloading', () => {
  const totals = [
    { period: '2026-05', total: 106 }, { period: '2026-04', total: 104 }, { period: '2026-03', total: 103 },
    { period: '2025-05', total: 100 }, { period: '2025-04', total: 100 }, { period: '2025-03', total: 100 },
  ];
  const d = buildDemand({ totals, policies: [{ effective_date: '2026-07-01' }], asof });
  assert.equal(d.export_momentum_yoy_pct, 6);
  assert.equal(d.seasonality_flag, 'peak_approaching'); // June → peak_approaching (calendar)
  assert.equal(d.frontloading_flag, true);
  assert.ok(['accelerating', 'stable', 'decelerating'].includes(d.momentum_trend));
});
test('buildDemand: no totals but seasonality-only still returns object', () => {
  const d = buildDemand({ totals: [], policies: [], asof: new Date('2026-06-15T00:00:00Z') });
  assert.equal(d.export_momentum_yoy_pct, null);
  assert.equal(d.seasonality_flag, 'peak_approaching');
});
