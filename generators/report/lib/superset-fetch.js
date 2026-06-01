'use strict';
// Superset API — session-cookie auth (no username/password required)
// Only SUPERSET_BASE env var is needed.
//
// Flow (mirrors browser devtools capture):
//   1. GET  {BASE}/superset/dashboard/fare/          → session cookie
//   2. GET  {BASE}/api/v1/security/csrf_token/       → csrf_token (+ refreshed cookie)
//   3. GET  {BASE}/api/v1/chart/{sliceId}/           → datasource_id + query_context
//   4. POST {BASE}/api/v1/chart/{sliceId}/data/      → time-series JSON
//      body = query_context from step 3 (or minimal fallback with datasource_id)

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
  const refreshed   = extractSession(r.headers.get('set-cookie')) || sessionCookie;
  const { result }  = await r.json();
  if (!result) throw new Error('csrf_token/ result 없음');
  return { csrfToken: result, sessionCookie: refreshed };
}

// Step 3 ─ GET chart metadata: datasource_id + stored query_context
async function getChartMeta(csrfToken, sessionCookie, sliceId) {
  const r = await fetch(`${BASE}/api/v1/chart/${sliceId}/`, {
    headers: {
      'User-Agent':  UA,
      'X-CSRFToken': csrfToken,
      Accept:        'application/json',
      Referer:       REFERER,
      Cookie:        sessionCookie,
    },
    signal: abort(),
  });
  if (!r.ok) throw new Error(`chart/${sliceId}/ meta → HTTP ${r.status}`);
  const json = await r.json();
  const res  = json?.result;
  if (!res) throw new Error(`chart/${sliceId}/ meta: empty result`);
  return {
    datasourceId:   res.datasource_id   || null,
    datasourceType: res.datasource_type || 'table',
    queryContext:   res.query_context   || null,   // JSON string stored by Superset
  };
}

// Step 4 ─ POST chart data to /api/v1/chart/data (not per-slice endpoint)
// query_context from step 3 is passed as body with force=true; fallback uses form_data param.
async function postChartData(csrfToken, sessionCookie, sliceId, meta) {
  const url = `${BASE}/api/v1/chart/data`;
  const commonHeaders = {
    'User-Agent':   UA,
    'X-CSRFToken':  csrfToken,
    'Content-Type': 'application/json',
    Accept:         'application/json',
    Referer:        REFERER,
    Cookie:         sessionCookie,
  };

  if (meta?.queryContext) {
    // Use stored query_context with force=true — exactly what the browser sends
    const qc = typeof meta.queryContext === 'string'
      ? JSON.parse(meta.queryContext)
      : { ...meta.queryContext };
    qc.force = true;
    const r = await fetch(url, {
      method: 'POST', headers: commonHeaders, body: JSON.stringify(qc), signal: abort(),
    });
    if (!r.ok) throw new Error(`chart/data (qc) → HTTP ${r.status}: ${await r.text().catch(() => '')}`);
    return r.json();
  }

  if (meta?.datasourceId) {
    // Fallback: minimal body from datasource_id
    const body = JSON.stringify({
      datasource:    { id: meta.datasourceId, type: meta.datasourceType || 'table' },
      queries:       [{ row_limit: 5000, orderby: [['__timestamp', true]] }],
      form_data:     JSON.stringify({ slice_id: sliceId }),
      result_format: 'json',
      result_type:   'full',
    });
    const r = await fetch(url, {
      method: 'POST', headers: commonHeaders, body, signal: abort(),
    });
    if (!r.ok) throw new Error(`chart/data (datasource) → HTTP ${r.status}: ${await r.text().catch(() => '')}`);
    return r.json();
  }

  // Last resort: form_data as query param, Superset resolves saved state
  const fd = encodeURIComponent(JSON.stringify({ slice_id: sliceId }));
  const r = await fetch(`${url}?form_data=${fd}&dashboard_id=1&force=true`, {
    method: 'POST', headers: commonHeaders, body: '{}', signal: abort(),
  });
  if (!r.ok) throw new Error(`chart/data (form_data fallback) → HTTP ${r.status}: ${await r.text().catch(() => '')}`);
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
  if (!sliceId) {
    console.warn('  superset: sliceId 미설정 → 건너뜀');
    return null;
  }
  try {
    const session                      = await getSession();
    console.log('  superset: 세션 확보');
    const { csrfToken, sessionCookie } = await getCsrf(session);
    console.log('  superset: CSRF 확보');
    const meta                         = await getChartMeta(csrfToken, sessionCookie, sliceId);
    console.log(`  superset: 차트 메타 확보 (datasource_id=${meta.datasourceId}, query_context=${meta.queryContext ? '있음' : '없음'})`);
    const json                         = await postChartData(csrfToken, sessionCookie, sliceId, meta);
    const chartData                    = parseResult(json);
    if (!chartData) throw new Error('결과 파싱 실패 — colnames 구조 확인 필요');
    console.log(`  superset: TAC ${chartData.labels.length}행 수집 (${chartData.datasets.length}개 계열, 최신월 ${chartData.labels.at(-1)})`);
    return chartData;
  } catch (e) {
    console.warn('  superset: 오류 —', e.message);
    return null;
  }
}

module.exports = { fetchSupersetAirIndex };
