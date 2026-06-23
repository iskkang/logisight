'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { haversineKm, resolveWaypoints, nearestApproachKm, proximateRoutes, nearbyAssets } = require('./proximity');

// 실제 좌표(시드 기준): MEKKHALA 중심 [125.6,18.5], 대만해협 [119.5,24.0], 상하이 [121.5,31.2].
const MEKKHALA = [125.6, 18.5];
const assetById = {
  taiwan: { id: 'taiwan', name: '대만 해협', type: 'choke', lon: 119.5, lat: 24.0 },
  shanghai: { id: 'shanghai', name: '상하이', type: 'port', lon: 121.5, lat: 31.2 },
  busan: { id: 'busan', name: '부산', type: 'port', lon: 129.0, lat: 35.1 },
};

test('haversineKm: 대만해협까지 ≈ 880km (great-circle)', () => {
  const km = haversineKm(MEKKHALA, [119.5, 24.0]);
  assert.ok(km > 850 && km < 910, `expected ~880, got ${km}`);
});

test('haversineKm: 같은 점은 0', () => {
  assert.equal(Math.round(haversineKm([10, 20], [10, 20])), 0);
});

test('resolveWaypoints: 이름은 asset 좌표로, [lon,lat]는 그대로', () => {
  const r = resolveWaypoints(['taiwan', [140, 20], 'unknown_id'], assetById);
  assert.equal(r.length, 2); // unknown_id는 좌표 없음 → 제외
  assert.deepEqual([r[0].lon, r[0].lat], [119.5, 24.0]);
  assert.deepEqual([r[1].lon, r[1].lat], [140, 20]);
});

test('nearestApproachKm: 경로 중 가장 가까운 지점 거리', () => {
  const wps = resolveWaypoints(['shanghai', 'taiwan', [140, 20]], assetById);
  const { km, label } = nearestApproachKm(MEKKHALA, wps);
  assert.ok(km > 850 && km < 910, `nearest should be taiwan ~880, got ${km}`);
  assert.equal(label, '대만 해협');
});

test('proximateRoutes: 1000km 내 노선만 (대만해협 통과 r3 포함, 부산 노선 r2 제외)', () => {
  const routes = [
    { id: 'r3', name: '아시아–미동안', waypoints: ['shanghai', 'taiwan', [140, 20]], chokes: ['taiwan'] },
    { id: 'r2', name: '환태평양', waypoints: ['busan', [150, 40]], chokes: [] },
  ];
  const out = proximateRoutes({ lon: 125.6, lat: 18.5 }, routes, assetById, 1000);
  assert.equal(out.length, 1);
  assert.equal(out[0].route.id, 'r3');
  assert.ok(out[0].km < 1000);
  assert.equal(out[0].label, '대만 해협');
});

test('proximateRoutes: 좌표 없는 이벤트(lon/lat null)는 빈 배열', () => {
  const routes = [{ id: 'r3', name: 'x', waypoints: ['taiwan'], chokes: [] }];
  assert.deepEqual(proximateRoutes({ lon: null, lat: null }, routes, assetById, 1000), []);
});

test('nearbyAssets: 임계 내 자산만 거리 오름차순', () => {
  const out = nearbyAssets({ lon: 125.6, lat: 18.5 }, Object.values(assetById), 1000);
  assert.ok(out.length >= 1);
  assert.equal(out[0].asset.id, 'taiwan'); // 가장 가까움
  assert.ok(out.every((x) => x.km <= 1000));
  assert.ok(!out.some((x) => x.asset.id === 'shanghai')); // ~1410km → 제외
});
