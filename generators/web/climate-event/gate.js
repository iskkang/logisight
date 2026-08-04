'use strict';
// 이벤트×자산/노선 근접 게이트(결정론). logisight-core src/lib/climate-gate.ts와 동일 규칙.
// 반경 비교는 비반올림 거리, 표시 km만 반올림. 판정은 이벤트 원본 severity('r'/'a').
const ASSET_RADIUS_KM = 200;
const ROUTE_RADIUS_KM = 1000;
const R = 6371;
function haversineKm(a, b) { // a,b = [lon,lat]
  const t = Math.PI / 180;
  const dLat = (b[1] - a[1]) * t, dLon = (b[0] - a[0]) * t;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * t) * Math.cos(b[1] * t) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}
function routeCoords(r, nodes) {
  return (r.waypoints || [])
    .map((w) => (typeof w === 'string' ? (nodes[w] ? [nodes[w].lon, nodes[w].lat] : null) : w))
    .filter(Boolean);
}
function gateEvent(event, assets, routes, nodes) {
  if (event.lon == null || event.lat == null) {
    return { tier: 'LIMITED', nearestAsset: null, nearestKm: null, linkedAssets: [], linkedRoutes: [] };
  }
  const e = [event.lon, event.lat];
  const linkedAssets = [];
  let nearest = null, nearestRaw = Infinity;
  for (const a of assets) {
    const raw = haversineKm(e, [a.lon, a.lat]);
    // name_ja도 함께 넘긴다. 여기서 떨어뜨리면 일본판 근거에 한국어 자산명이 남는다.
    const la = { id: a.id, name: a.name, name_ja: a.name_ja, type: a.type, km: Math.round(raw) };
    if (raw < nearestRaw) { nearest = la; nearestRaw = raw; }
    if (raw <= ASSET_RADIUS_KM) linkedAssets.push(la);
  }
  linkedAssets.sort((x, y) => x.km - y.km);
  const linkedRoutes = [];
  for (const r of routes || []) {
    let min = Infinity;
    for (const c of routeCoords(r, nodes)) { const d = haversineKm(e, c); if (d < min) min = d; }
    if (min <= ROUTE_RADIUS_KM) linkedRoutes.push({ id: r.id, name: r.name, name_ja: r.name_ja });
  }
  const linked = linkedAssets.length > 0 || linkedRoutes.length > 0;
  const sev = event.severity;
  const tier = !linked ? 'LIMITED' : sev === 'r' ? 'LINKED_HIGH' : sev === 'a' ? 'LINKED_WATCH' : 'LIMITED';
  return { tier, nearestAsset: nearest, nearestKm: nearest ? nearest.km : null, linkedAssets, linkedRoutes };
}
module.exports = { gateEvent, haversineKm, ASSET_RADIUS_KM, ROUTE_RADIUS_KM };
