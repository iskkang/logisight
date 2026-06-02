'use strict';
// Superset API — session-cookie auth (no username/password required)
// Only SUPERSET_BASE env var is needed.
//
// Flow (confirmed from browser devtools):
//   1. GET  {BASE}/superset/dashboard/fare/          → session cookie
//   2. GET  {BASE}/api/v1/security/csrf_token/       → csrf_token
//   3. POST {BASE}/api/v1/chart/data
//            ?form_data={"slice_id":N}&dashboard_id=D&force
//            body: {}                                → time-series JSON
//      (Superset resolves saved query_context from slice_id — no meta GET needed)
//   4. Fallback: GET /api/v1/chart/{id}/ → query_context → POST /api/v1/chart/data

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env.local') });

const BASE    = (process.env.SUPERSET_BASE || '').replace(/\/$/, '');
const REFERER = `${BASE}/superset/dashboard/fare/`;
const UA      = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const TIMEOUT = 20000;

function abort() { return AbortSignal.timeout(TIMEOUT); }

function extractSession(setCookieHeader) {
  if (!setCookieHeader) return null;
  const m = setCookieHeader.match(/(?:^|,\s*)session=([^;,]+)/i);
  return m ? `session=${m[1]}` : null;
}

// Step 1 ─ establish session
async function getSession() {
  const r = await fetch(REFERER, {
    headers: { 'User-Agent': UA, Accept: 'text/html,*/*' },
    redirect: 'follow',
    signal: abort(),
  });
  const cookie = extractSession(r.headers.get('set-cookie'));
  if (!cookie) throw new Error('session cookie 없음 (set-cookie header missing)');
  return cookie;
}

// Step 2 ─ csrf_token
async function getCsrf(sessionCookie) {
  const r = await fetch(`${BASE}/api/v1/security/csrf_token/`, {
    headers: { 'User-Agent': UA, Accept: 'application/json', Cookie: sessionCookie },
    signal: abort(),
  });
  if (!r.ok) throw new Error(`csrf_token/ → HTTP ${r.status}`);
  const refreshed  = extractSession(r.headers.get('set-cookie')) || sessionCookie;
  const { result } = await r.json();
  if (!result) throw new Error('csrf_token/ result 없음');
  return { csrfToken: result, sessionCookie: refreshed };
}

// Step 3 (primary) ─ GET /api/v1/chart/{id}/data/
// Works even when the chart meta GET (/api/v1/chart/{id}/) returns 404.
// This endpoint returns cached or freshly executed chart results without requiring
// the caller to supply query_context — Superset resolves it internally from the DB.
async function getChartDataDirect(headers, sliceId) {
  const r = await fetch(`${BASE}/api/v1/chart/${sliceId}/data/`, {
    headers, signal: abort(),
  });
  if (!r.ok) throw new Error(`chart/${sliceId}/data/ → HTTP ${r.status}`);
  return r.json();
}

// Parse TAC Index time-series response:
//   colnames = ["__timestamp", "Frankfurt-N America", "Hong Kong-Europe", ...]
//   data[i]  = { __timestamp: <ms>, "Frankfurt-N America": <$/kg>, ... }
function parseResult(json) {
  const result = json?.result?.[0];
  if (!result?.data?.length) return null;

  const cols = (result.colnames || []).filter(c => c !== '__timestamp');
  if (!cols.length) return null;

  const rows   = [...result.data].sort((a, b) => a.__timestamp - b.__timestamp);
  const labels = rows.map(r => new Date(r.__timestamp).toISOString().slice(0, 7));

  const COLORS = ['#E08E45', '#2E86AB', '#6A994E', '#BC4749', '#8E7DBE'];
  const datasets = cols.map((col, i) => ({
    label:           col,
    data:            rows.map(r => { const v = parseFloat(r[col]); return isNaN(v) ? null : v; }),
    borderColor:     COLORS[i % COLORS.length],
    backgroundColor: 'transparent',
    borderWidth: 2, pointRadius: 2, tension: 0.25, spanGaps: true,
  }));

  return { labels, datasets };
}

// Public ─ returns Chart.js time-series data or null
async function fetchSupersetAirIndex({ sliceId, dashboardId } = {}) {
  if (!BASE) {
    console.warn('  superset: SUPERSET_BASE 미설정 → 건너뜀');
    return null;
  }
  if (!sliceId) {
    console.warn('  superset: sliceId 미설정 → 건너뜀');
    return null;
  }
  try {
    const session                      = await getSession();
    console.log('  superset: 세션 확보');
    const { csrfToken, sessionCookie } = await getCsrf(session);
    console.log('  superset: CSRF 확보');

    const apiHeaders = {
      'User-Agent':  UA,
      'X-CSRFToken': csrfToken,
      Accept:        'application/json',
      Referer:       REFERER,
      Cookie:        sessionCookie,
    };

    // GET /api/v1/chart/{id}/data/ works even when /api/v1/chart/{id}/ returns 404.
    const json = await getChartDataDirect(apiHeaders, sliceId);

    const chartData = parseResult(json);
    if (!chartData) throw new Error('결과 파싱 실패 — colnames 구조 확인 필요');
    console.log(`  superset: TAC ${chartData.labels.length}행 수집 (${chartData.datasets.length}개 계열, 최신월 ${chartData.labels.at(-1)})`);
    return chartData;
  } catch (e) {
    console.warn('  superset: 오류 —', e.message);
    return null;
  }
}

module.exports = { fetchSupersetAirIndex };
