'use strict';
// Superset API — session-cookie auth (no username/password required)
// Only SUPERSET_BASE env var is needed.
//
// Flow (mirrors browser devtools capture):
//   1. GET  {BASE}/superset/dashboard/fare/          → session cookie
//   2. GET  {BASE}/api/v1/security/csrf_token/       → csrf_token (+ refreshed cookie)
//   3. POST {BASE}/api/v1/chart/data?form_data=…     → time-series JSON

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env.local') });

const BASE    = (process.env.SUPERSET_BASE || '').replace(/\/$/, '');
const REFERER = `${BASE}/superset/dashboard/fare/`;
const UA      = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const TIMEOUT = 20000;

function abort() { return AbortSignal.timeout(TIMEOUT); }

// Extract the first session= value from a Set-Cookie header
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
  if (!cookie) throw new Error('セッションcookieなし (set-cookie header missing)');
  return cookie;
}

// Step 2 ─ csrf_token
async function getCsrf(sessionCookie) {
  const r = await fetch(`${BASE}/api/v1/security/csrf_token/`, {
    headers: {
      'User-Agent': UA,
      Accept: 'application/json',
      Cookie: sessionCookie,
    },
    signal: abort(),
  });
  if (!r.ok) throw new Error(`csrf_token/ → HTTP ${r.status}`);
  // Server may rotate the session; keep the newest version
  const refreshed   = extractSession(r.headers.get('set-cookie')) || sessionCookie;
  const { result }  = await r.json();
  if (!result) throw new Error('csrf_token/ result 없음');
  return { csrfToken: result, sessionCookie: refreshed };
}

// Step 3 ─ GET /api/v1/chart/{id}/data/ (uses chart's stored config — no body needed)
async function postChartData(csrfToken, sessionCookie, sliceId) {
  const url = `${BASE}/api/v1/chart/${sliceId}/data/`;
  const r = await fetch(url, {
    headers: {
      'User-Agent':  UA,
      'X-CSRFToken': csrfToken,
      Accept:        'application/json',
      Referer:       REFERER,
      Cookie:        sessionCookie,
    },
    signal: abort(),
  });
  if (!r.ok) throw new Error(`chart/${sliceId}/data → HTTP ${r.status}: ${await r.text().catch(() => '')}`);
  return r.json();
}

// Parse actual response schema (confirmed from devtools):
//   result[0].colnames = ["__timestamp", "Frankfurt-N America", "Hong Kong-Europe", ...]
//   result[0].data[i]  = { __timestamp: <ms float>, "Frankfurt-N America": <$/kg>, ... }
// __timestamp is Unix milliseconds (monthly granularity)
function parseResult(json) {
  const result = json?.result?.[0];
  if (!result?.data?.length) return null;

  const cols = (result.colnames || []).filter(c => c !== '__timestamp');
  if (!cols.length) return null;

  // Sort ascending by timestamp so chart x-axis is chronological
  const rows = [...result.data].sort((a, b) => a.__timestamp - b.__timestamp);
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

// Public ─ returns Chart.js data or null
async function fetchSupersetAirIndex({ sliceId, dashboardId } = {}) {
  if (!BASE) {
    console.warn('  superset: SUPERSET_BASE 미설정 → 건너뜀');
    return null;
  }
  try {
    const session               = await getSession();
    console.log('  superset: 세션 확보');
    const { csrfToken, sessionCookie } = await getCsrf(session);
    console.log('  superset: CSRF 확보');
    const json                  = await postChartData(csrfToken, sessionCookie, sliceId);
    const chartData             = parseResult(json);
    if (!chartData) throw new Error('결과 파싱 실패 — colnames 구조 확인 필요');
    console.log(`  superset: ${chartData.labels.length}개 월간 데이터 (${chartData.datasets.length}개 계열)`);
    return chartData;
  } catch (e) {
    console.warn('  superset: 오류 —', e.message);
    return null;
  }
}

module.exports = { fetchSupersetAirIndex };
