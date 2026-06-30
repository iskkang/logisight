'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { gateEvent } = require('./gate');

const asset = (id, lon, lat, type = 'inland') => ({ id, name: id, type, lon, lat, freeze_prone: false });
const ev = (o) => ({ id: 'e1', source: 'nws', kind: 'flood', severity: 'r', lon: 0, lat: 0, track: null, ...o });

test('자산 위 severity r → LINKED_HIGH (NWS 통과)', () => {
  const v = gateEvent(ev({ source: 'nws', severity: 'r' }), [asset('chi', 0, 0)], [], {});
  assert.equal(v.tier, 'LINKED_HIGH');
  assert.equal(v.linkedAssets.length, 1);
});
test('위도 1°(~111km) severity r → LINKED_HIGH', () => {
  assert.equal(gateEvent(ev({ lat: 1 }), [asset('chi', 0, 0)], [], {}).tier, 'LINKED_HIGH');
});
test('위도 2°(~222km) 단일 자산 → LIMITED, nearestKm>200', () => {
  const v = gateEvent(ev({ lat: 2 }), [asset('chi', 0, 0)], [], {});
  assert.equal(v.tier, 'LIMITED');
  assert.ok(v.nearestKm > 200);
});
test('반경 내 severity a → LINKED_WATCH', () => {
  assert.equal(gateEvent(ev({ severity: 'a' }), [asset('chi', 0, 0)], [], {}).tier, 'LINKED_WATCH');
});
test('severity 없음 → LIMITED', () => {
  assert.equal(gateEvent(ev({ severity: '' }), [asset('chi', 0, 0)], [], {}).tier, 'LIMITED');
});
test('좌표 없음 → LIMITED, nearestAsset null', () => {
  const v = gateEvent(ev({ lon: null, lat: null }), [asset('chi', 0, 0)], [], {});
  assert.equal(v.tier, 'LIMITED');
  assert.equal(v.nearestAsset, null);
});
test('노선 waypoint 근접(자산은 멀리) → LINKED_HIGH, linkedRoutes', () => {
  const routes = [{ id: 'r1', name: 'R1', waypoints: [[0, 0]] }];
  const v = gateEvent(ev({ severity: 'r' }), [asset('far', 100, 80)], routes, {});
  assert.equal(v.tier, 'LINKED_HIGH');
  assert.equal(v.linkedRoutes[0].name, 'R1');
  assert.equal(v.linkedAssets.length, 0);
});
