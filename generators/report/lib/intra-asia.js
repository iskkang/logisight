'use strict';
// Intra-Asia container freight — KCCI sub-routes proxy from Supabase
// Routes: KCCI_CN (한국→중국), KCCI_JP (한국→일본), KCCI_SEA (한국→동남아)
// These are the most reliable proxy for intra-Asia spot rates available in our DB.
// Cache: outputs/cache/intra-asia.json (TTL 7 days)

const path = require('path');
const fs   = require('fs');
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env.local') });
if (typeof globalThis.WebSocket === 'undefined') { try { globalThis.WebSocket = require('ws'); } catch (_) {} }
const { createClient } = require('@supabase/supabase-js');
const { prevAtOrBefore } = require('./series-delta');

const CACHE_PATH = path.resolve(__dirname, '../../../outputs/cache/intra-asia.json');
const CACHE_TTL  = 7 * 24 * 60 * 60 * 1000;

const INTRA_CODES  = ['KCCI_CN', 'KCCI_JP', 'KCCI_SEA'];
const INTRA_LABELS = { KCCI_CN: '한국→중국', KCCI_JP: '한국→일본', KCCI_SEA: '한국→동남아' };
const COLORS       = ['#2E86AB', '#E08E45', '#6A994E'];

// ── Supabase ──────────────────────────────────────────────────────────────────

function sb() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } }
  );
}

async function loadIntraRoutes(weekEnd) {
  let q = sb().from('freight_indices')
    .select('index_code,week_date,value')
    .in('index_code', INTRA_CODES);
  if (weekEnd) q = q.lte('week_date', weekEnd);
  const { data, error } = await q
    .order('week_date', { ascending: false })
    .limit(INTRA_CODES.length * 14);

  if (error || !data || !data.length) return null;

  const byCode = {};
  for (const r of data) {
    if (r.value == null) continue;
    (byCode[r.index_code] = byCode[r.index_code] || []).push({ week: r.week_date, v: Number(r.value) });
  }
  for (const code of Object.keys(byCode)) {
    byCode[code].sort((a, b) => b.week.localeCompare(a.week));
  }
  return Object.keys(byCode).length ? byCode : null;
}

// ── Cache I/O ─────────────────────────────────────────────────────────────────

function loadCache() {
  try {
    if (!fs.existsSync(CACHE_PATH)) return null;
    const raw = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf-8'));
    const age = Date.now() - new Date(raw.fetched_at).getTime();
    if (age > CACHE_TTL) return null;
    return raw;
  } catch (_) { return null; }
}

function saveCache(payload) {
  try {
    fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
    fs.writeFileSync(
      CACHE_PATH,
      JSON.stringify({ fetched_at: new Date().toISOString(), ...payload }, null, 2),
      'utf-8',
    );
  } catch (e) { console.warn('  intra-asia: 캐시 저장 실패:', e.message); }
}

// ── Renderers ─────────────────────────────────────────────────────────────────

function fmtVal(v) { return (v == null || isNaN(v)) ? '—' : Math.round(v).toLocaleString('ko-KR'); }

function fmtChg(curr, prev) {
  if (prev == null || curr == null || prev === 0) return '—';
  const pct = ((curr - prev) / prev) * 100;
  return (pct >= 0 ? '▲' : '▼') + ' ' + Math.abs(pct).toFixed(1) + '%';
}

function buildTable(byCode) {
  const rows = [];
  let latestWeek = '';

  for (const code of INTRA_CODES) {
    const s = byCode[code];
    if (!s || !s.length) { rows.push('| ' + (INTRA_LABELS[code] || code) + ' | — | — | — |'); continue; }
    if (!latestWeek) latestWeek = s[0].week;
    const latest = s[0].v;
    rows.push(
      '| ' + (INTRA_LABELS[code] || code) +
      ' | ' + fmtVal(latest) +
      ' | ' + fmtChg(latest, s[1]?.v ?? null) +
      ' | ' + fmtChg(latest, prevAtOrBefore(s, s[0].week, 28)?.v ?? null) + ' |'
    );
  }

  const srcNote = '\n※ ' + latestWeek + ' 기준. 출처: KOBC (KCCI 역내 항로 proxy).';
  return [
    '| 노선 | 최신값 | 전주 대비 | 전월 대비 |',
    '|------|--------|---------|---------|',
    ...rows,
    '',
    srcNote,
  ].join('\n');
}

function buildFactText(byCode) {
  const lines = [];
  let latestWeek = '';
  for (const code of INTRA_CODES) {
    const s = byCode[code];
    if (!s || !s.length) continue;
    if (!latestWeek) latestWeek = s[0].week;
    const latest = s[0].v;
    lines.push(
      (INTRA_LABELS[code] || code) + '(' + code + '): ' + fmtVal(latest) +
      ' 전주=' + fmtChg(latest, s[1]?.v ?? null) +
      ' 전월=' + fmtChg(latest, prevAtOrBefore(s, s[0].week, 28)?.v ?? null) +
      ' (' + s[0].week + ')'
    );
  }
  if (!lines.length) return '';
  lines.push('(출처: KOBC / KCCI 역내 항로, ' + latestWeek + ')');
  return lines.join('\n');
}

function buildChartData(byCode) {
  const dateSet = new Set();
  for (const code of INTRA_CODES) {
    if (byCode[code]) byCode[code].slice(0, 8).forEach(r => dateSet.add(r.week));
  }
  const labels = [...dateSet].sort().slice(-8);
  if (!labels.length) return null;

  const datasets = INTRA_CODES.filter(c => byCode[c]).map((code, i) => {
    const byWeek = {};
    (byCode[code] || []).forEach(r => { byWeek[r.week] = r.v; });
    return {
      label: INTRA_LABELS[code] || code,
      data: labels.map(w => byWeek[w] ?? null),
      borderColor: COLORS[i % COLORS.length],
      backgroundColor: 'transparent',
      borderWidth: 2, pointRadius: 2, tension: 0.25, spanGaps: true,
    };
  });

  return datasets.length ? { labels, datasets } : null;
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function buildIntraAsia({ force = false, weekEnd } = {}) {
  if (!force && !weekEnd) {
    const cached = loadCache();
    if (cached) { console.log('  intra-asia: 캐시 사용 (' + (cached.as_of || '') + ')'); return cached; }
  }

  console.log('  intra-asia: Supabase KCCI 역내 항로 수집...');
  const byCode = await loadIntraRoutes(weekEnd);
  if (!byCode) { console.warn('  intra-asia: Supabase 데이터 없음'); return null; }

  const allRows    = Object.values(byCode).flat().sort((a, b) => b.week.localeCompare(a.week));
  const latestWeek = allRows[0]?.week || '';

  const table     = buildTable(byCode);
  const factText  = buildFactText(byCode);
  const chartData = buildChartData(byCode);

  const payload = {
    as_of: new Date().toISOString().slice(0, 10),
    source: 'KOBC (KCCI 역내)',
    table, factText, chartData,
  };
  if (!weekEnd) saveCache(payload);
  console.log('  intra-asia: 완료 (' + latestWeek + ')');
  return payload;
}

module.exports = { buildIntraAsia, CACHE_PATH };
