/* ============================================================================
 * 기상 리스크 지구본 — Supabase 데이터 로더 (드롭인 스니펫)
 * ----------------------------------------------------------------------------
 * 지구본 프로토타입 HTML의 IIFE 안에서, 하드코딩된 배열
 *   PORTS / CHOKES / ROUTES / SPOTS 와 합성 함수 riskAtH, nearSpot
 * 를 삭제하고 이 블록으로 대체한다.
 *
 * <head> 에 supabase-js 추가 필요:
 *   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
 *
 * 호스트 프로토타입이 이미 정의하고 있다고 가정하는 전역:
 *   HDAYS  — horizon 일수 배열, 예: [0,3,7,14]   (asset_risk.horizon_days 와 일치해야 함)
 *   HLBL   — horizon 라벨 배열, 예: ['지금','+3일','+7일','+14일']
 *   hIdx   — 현재 선택된 horizon 인덱스
 *   level(), rc()  — 점수→등급/색 매핑 (시그니처 그대로 유지)
 *   render(), render2(), tick(), resize(), reduce  — 렌더 루프
 * 위 HDAYS/HLBL 가 호스트에 없으면 아래 기본값을 사용 (있으면 호스트 것을 우선).
 * ==========================================================================*/

// --- 설정 + 클라이언트 -------------------------------------------------------
// anon 키는 공개용(프론트 노출 OK). 데이터 보호는 RLS(읽기 전용)가 담당.
var SB_URL  = "https://hmgbvqczmyjixkqbruzp.supabase.co";
var SB_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhtZ2J2cWN6bXlqaXhrcWJydXpwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk1MTIyNzIsImV4cCI6MjA5NTA4ODI3Mn0.cvMs8vhretzH7vL6w-UN8XkWJoOpXpQvLs_HIOTTG0I";
var sb = supabase.createClient(SB_URL, SB_ANON);

// 호스트에 HDAYS/HLBL 가 없을 때만 기본값 (있으면 그대로 둠).
if (typeof HDAYS === 'undefined') { var HDAYS = [0, 3, 7, 14]; }
if (typeof HLBL  === 'undefined') { var HLBL  = ['지금', '+3일', '+7일', '+14일']; }

var PORTS = [], CHOKES = [], NODES = {}, ROUTES = [], SPOTS = [], riskMap = {};
// v2: 통합 자산 배열(port/choke/rail) + 글로벌 이벤트 레이어.
// 렌더/인터랙션(node·event 핀·render2·renderAlerts·hitTest·범례) 편집은 globe-v2.md 참고.
var ASSETS = [], EVENTS = [], eventHit = [], selEvent = null;

// --- 데이터 로더 (부팅을 async로) -------------------------------------------
async function loadData() {
  var a  = await sb.from('assets').select('*');
  var rt = await sb.from('routes').select('*');
  var rk = await sb.from('asset_risk').select('*');
  var ws = await sb.from('weather_systems').select('*');
  var ev = await sb.from('events').select('*');
  var assets = a.data || [];
  EVENTS = ev.data || [];
  PORTS  = assets.filter(function (x) { return x.type === 'port'; }).map(function (x) { return [x.id, x.name, x.lon, x.lat]; });
  CHOKES = assets.filter(function (x) { return x.type === 'choke'; }).map(function (x) { return [x.id, x.name, x.lon, x.lat]; });
  // v2: 단일 ASSETS (port/choke/rail 통합), NODES에 freeze_prone 포함
  ASSETS = assets.map(function (x) { NODES[x.id] = { key: x.id, name: x.name, lon: x.lon, lat: x.lat, type: x.type, freeze_prone: x.freeze_prone }; return NODES[x.id]; });
  ROUTES = (rt.data || []).map(function (r) {
    var wp = r.waypoints, keys = wp.filter(function (w) { return typeof w === 'string'; });
    return { id: r.id, name: r.name, wp: wp, keys: keys, chokes: r.chokes || [] };
  });
  riskMap = {};
  (rk.data || []).forEach(function (r) { (riskMap[r.asset_id] = riskMap[r.asset_id] || {})[r.horizon_days] = r; });
  // weather_systems → SPOTS (지금은 비어있으면 핀 없음)
  var byId = {};
  (ws.data || []).forEach(function (r) {
    var s = byId[r.id] = byId[r.id] || { id: r.id, label: r.label, color: r.color, trk: [], int: [] };
    var hi = HDAYS.indexOf(r.horizon_days); if (hi >= 0) { s.trk[hi] = [r.lon, r.lat]; s.int[hi] = r.intensity; }
  });
  SPOTS = Object.keys(byId).map(function (k) { return byId[k]; });
}

// --- 리스크 조회 함수 (기존 합성 함수 대체) ----------------------------------
function arRow(n) { return riskMap[n.key] && riskMap[n.key][HDAYS[hIdx]]; }
function assetRisk(n) { var r = arRow(n); return r ? r.score : 0; }
function assetDriver(n) { var r = arRow(n); return r && r.score >= 30 ? r.driver : '정상'; }
function routeRisk(R) { var m = 0; R.keys.forEach(function (k) { var r = riskMap[k] && riskMap[k][HDAYS[hIdx]]; if (r) m = Math.max(m, r.score); }); return m; }
function firstAlert(assetId) {
  var labelFor = function (d) { return HLBL[HDAYS.indexOf(d)]; };
  for (var i = 0; i < HDAYS.length; i++) { var r = riskMap[assetId] && riskMap[assetId][HDAYS[i]]; if (r && r.score >= 60) return '경보 ' + labelFor(HDAYS[i]); }
  for (var j = 0; j < HDAYS.length; j++) { var r2 = riskMap[assetId] && riskMap[assetId][HDAYS[j]]; if (r2 && r2.score >= 30) return '주의 ' + labelFor(HDAYS[j]); }
  return '없음';
}

/* ----------------------------------------------------------------------------
 * 기존 코드 치환 (spec 5-c):
 *   nearSpot(n.lon,n.lat,hIdx) 로 만들던 "주요 기상 요인"·리스트 <small>·알림 텍스트
 *       → assetDriver(n) 사용.
 *   firstAlert(n.lon,n.lat) 호출부 → firstAlert(n.key).
 *   level(), rc(), assetRisk(), routeRisk() 호출부는 그대로 (시그니처 동일).
 *
 * 부팅부 (spec 5-d) — 기존 맨 아래 `resize(); render2(); ...` 블록을 아래로 대체.
 * d3 미로드 가드는 유지.
 *
 *   (async function boot(){
 *     await loadData();
 *     resize(); render2();
 *     if(reduce){ render(); } else requestAnimationFrame(tick);
 *   })();
 * --------------------------------------------------------------------------*/
