'use strict';
// 이벤트(점좌표) × 노선/자산 근접 — 서버측 대권거리(great-circle).
// 프론트는 현재 이벤트 핀만 렌더하고 근접 계산은 없음 → 본 모듈이 공유 기준을 정의한다.
// (d3-geo geoDistance × 지구반경과 동일한 의미. 임계 1000km.)

const R_KM = 6371;
const rad = (d) => (d * Math.PI) / 180;

// a,b: [lon,lat]
function haversineKm(a, b) {
  const dLat = rad(b[1] - a[1]);
  const dLon = rad(b[0] - a[0]);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * R_KM * Math.asin(Math.min(1, Math.sqrt(s)));
}

// waypoints: ["shanghai",[60,8],...] → [{label,lon,lat}]. 이름은 asset 좌표로 치환, 미해결 이름은 제외.
function resolveWaypoints(waypoints, assetById) {
  const out = [];
  for (const w of waypoints || []) {
    if (Array.isArray(w)) {
      out.push({ label: '해상 지점', lon: w[0], lat: w[1] });
    } else {
      const a = assetById[w];
      if (a) out.push({ label: a.name, lon: a.lon, lat: a.lat });
    }
  }
  return out;
}

// 이벤트 점에서 경로 상 가장 가까운 지점까지 거리.
function nearestApproachKm(eventPt, resolvedWaypoints) {
  let best = { km: Infinity, label: null };
  for (const wp of resolvedWaypoints) {
    const km = haversineKm(eventPt, [wp.lon, wp.lat]);
    if (km < best.km) best = { km, label: wp.label };
  }
  return best;
}

// event:{lon,lat}. 임계 내 노선만 [{route,km,label}], 거리 오름차순.
function proximateRoutes(event, routes, assetById, thresholdKm) {
  if (event.lon == null || event.lat == null) return [];
  const pt = [event.lon, event.lat];
  const out = [];
  for (const route of routes) {
    const wps = resolveWaypoints(route.waypoints, assetById);
    const { km, label } = nearestApproachKm(pt, wps);
    if (km <= thresholdKm) out.push({ route, km, label });
  }
  return out.sort((a, b) => a.km - b.km);
}

// 임계 내 자산만 [{asset,km}], 거리 오름차순.
function nearbyAssets(event, assetList, thresholdKm) {
  if (event.lon == null || event.lat == null) return [];
  const pt = [event.lon, event.lat];
  return assetList
    .map((asset) => ({ asset, km: haversineKm(pt, [asset.lon, asset.lat]) }))
    .filter((x) => x.km <= thresholdKm)
    .sort((a, b) => a.km - b.km);
}

module.exports = { haversineKm, resolveWaypoints, nearestApproachKm, proximateRoutes, nearbyAssets };
