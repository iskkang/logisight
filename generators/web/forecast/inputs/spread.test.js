'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildSpread, spreadContextEvent } = require('./spread');

function series(vals, startIso) {
  // vals[0] = 최신. date 주간 내림차순.
  const d0 = new Date(`${startIso}T00:00:00Z`).getTime();
  return vals.map((v, i) => ({ value: v, date: new Date(d0 - i * 7 * 86400000).toISOString().slice(0, 10) }));
}

test('buildSpread: < 8 aligned weeks → available:false', () => {
  assert.equal(buildSpread(series([1, 2], '2026-06-01'), series([1, 1], '2026-06-01')).available, false);
});

test('buildSpread: spot ratio rising 8+ weeks → persistent gaining', () => {
  // 현물 매주 상승, 계약 고정 → 비율 매주 상승(현물 강세)
  const spot = series([1180, 1160, 1140, 1120, 1100, 1080, 1060, 1040, 1020], '2026-06-01');
  const contract = series([1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000], '2026-06-01');
  const s = buildSpread(spot, contract);
  assert.equal(s.available, true);
  assert.equal(s.direction, 'spot_gaining');
  assert.equal(s.gaining_weeks >= 8, true);
  assert.equal(s.persistent_8w, true);
});

test('spreadContextEvent: persistent gaining → H3 string', () => {
  const ev = spreadContextEvent({ available: true, gaining_weeks: 9, losing_weeks: 0 });
  assert.match(ev, /현물.*연속 강세.*H3/);
});
test('spreadContextEvent: not persistent → null', () => {
  assert.equal(spreadContextEvent({ available: true, gaining_weeks: 3, losing_weeks: 0 }), null);
  assert.equal(spreadContextEvent({ available: false }), null);
});
