'use strict';
// T1-1 replacement: IMF Portwatch 수에즈 운하 일별 컨테이너 통과 수 → cape_share_pct.
// 출처: https://portwatch.imf.org/ (공개 ArcGIS REST API, 인증 불필요)
// red_sea_diversion 테이블 호환 — diversion.js / buildDiversion 변경 없음.

const PORTWATCH_URL =
  'https://services9.arcgis.com/weJ1QsnbMYJlCHdG/ArcGIS/rest/services/Daily_Chokepoints_Data/FeatureServer/0/query';
const SUEZ_ID = 'chokepoint1';
// 2023-01-01 ~ 2023-10-31 평균 일별 컨테이너 통과 수 (Red Sea 위기 이전).
// 산출: IMF Portwatch API 304일 평균 = 19.84 (일회성 쿼리, 상수 고정)
const SUEZ_BASELINE = 19.8;
const SOURCE = 'IMF Portwatch (auto)';
const UA = 'Mozilla/5.0 (compatible; logisight-diversion/1.0)';

// rows: [{date:'YYYY-MM-DD', n_container:number}], baseline: number
// 최근 7일 평균으로 cape_share_pct 계산.
// 반환: {cape_share_pct, suez_share_pct, as_of, current_avg, baseline, source} | null
function buildCapeShare(rows, baseline) {
  const b = baseline ?? SUEZ_BASELINE;
  const valid = (rows || []).filter(
    (r) => r.n_container != null && Number.isFinite(r.n_container) && r.n_container >= 0,
  );
  if (!valid.length || !b) return null;
  const sorted = [...valid].sort((a, b_) => (a.date < b_.date ? 1 : -1)); // desc
  const recent = sorted.slice(0, 7);
  const avg = recent.reduce((s, r) => s + r.n_container, 0) / recent.length;
  const deviation = (b - avg) / b;
  const cape = Math.round(Math.max(0, Math.min(100, deviation * 100)));
  return {
    cape_share_pct: cape,
    suez_share_pct: Math.max(0, 100 - cape),
    as_of: sorted[0].date,
    current_avg: Math.round(avg * 10) / 10,
    baseline: b,
    source: SOURCE,
  };
}

// daysBack일치 수에즈 일별 데이터 조회.
// ArcGIS REST는 date를 Unix 밀리초(epoch ms)로 반환.
async function fetchPortwatchTransits(daysBack = 14) {
  const since = new Date(Date.now() - daysBack * 86400000).toISOString().slice(0, 10);
  const params = new URLSearchParams({
    where: `portid='${SUEZ_ID}' AND date >= TIMESTAMP '${since} 00:00:00'`,
    outFields: 'date,n_container',
    f: 'json',
    resultRecordCount: '50',
    orderByFields: 'date DESC',
  });
  const res = await fetch(`${PORTWATCH_URL}?${params}`, {
    headers: { 'User-Agent': UA },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  return (json?.features ?? [])
    .map((f) => ({
      date: new Date(f.attributes.date).toISOString().slice(0, 10),
      n_container: f.attributes.n_container,
    }))
    .filter((r) => r.date && r.n_container != null);
}

// rows 전체에서 현재 주(days 1-7)와 이전 주(days 8-14) 두 기간을 계산.
// buildDiversion이 Δ 계산에 2행 필요 → 매 실행에서 두 행 upsert.
// 반환: [currentPeriod, prevPeriod] (prevPeriod가 없으면 [currentPeriod])  | null
function buildTwoPeriods(rows, baseline) {
  const b = baseline ?? SUEZ_BASELINE;
  const valid = (rows || [])
    .filter((r) => r.n_container != null && Number.isFinite(r.n_container) && r.n_container >= 0)
    .sort((a, b_) => (a.date < b_.date ? 1 : -1)); // desc
  if (!valid.length) return null;
  const current = buildCapeShare(valid.slice(0, 7), b);
  if (!current) return null;
  const prev = valid.length > 7 ? buildCapeShare(valid.slice(7), b) : null;
  return prev ? [current, prev] : [current];
}

// 합성: fetch 21일 → buildTwoPeriods. 실패 시 null (더미 금지).
async function fetchAndBuildDiversion() {
  try {
    const rows = await fetchPortwatchTransits(21);
    if (!rows.length) return null;
    return buildTwoPeriods(rows);
  } catch (e) {
    console.warn('  portwatch-diversion: 실패 —', e.message);
    return null;
  }
}

module.exports = { buildCapeShare, buildTwoPeriods, fetchPortwatchTransits, fetchAndBuildDiversion, SUEZ_BASELINE, SOURCE };
