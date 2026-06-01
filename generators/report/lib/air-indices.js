'use strict';
// Air cargo index data for the monthly report air section.
// Priority: Superset BI (TAC Index $/kg, 3 routes) → WorldACD page scrape → BAI only
// Cache:    outputs/cache/air-index.json  (TTL 7 days — avoids hammering BI)
//
// Cache schema:
//   { fetched_at, source, chartData:{labels,datasets}, table, factText }

const path = require('path');
const fs   = require('fs');

const { fetchSupersetAirIndex } = require('./superset-fetch');
const BI_CHARTS  = require('../config/bi-charts.json');

const CACHE_PATH = path.resolve(__dirname, '../../../outputs/cache/air-index.json');
const CACHE_TTL  = 7 * 24 * 60 * 60 * 1000;   // 7 days in ms

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
  } catch (e) { console.warn('  air-indices: 캐시 저장 실패:', e.message); }
}

// ── ISO week helpers ───────────────────────────────────────────────────────────

function isoWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const jan1 = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - jan1) / 86400000) + 1) / 7);
}
function isoYear(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  return d.getUTCFullYear();
}

// ── HTTP helper ────────────────────────────────────────────────────────────────

async function fetchPage(url) {
  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LogisightBot/1.0)' },
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) return null;
    return await r.text();
  } catch (_) { return null; }
}

function stripHtml(html) {
  return html.replace(/<script[\s\S]*?<\/script>/gi, ' ')
             .replace(/<style[\s\S]*?<\/style>/gi, ' ')
             .replace(/<[^>]+>/g, ' ')
             .replace(/&nbsp;/g, ' ')
             .replace(/&amp;/g, '&')
             .replace(/\s+/g, ' ');
}

// ── WorldACD scrape (fallback) ─────────────────────────────────────────────────

function extractSpotRate(text) {
  const PATS = [
    /(?:spot|average|avg|overall)[^$\d]{0,30}\$([\d.]+)\s*(?:per\s*)?kg/i,
    /\$([\d.]+)\s*(?:per\s*)?kg(?:\s*(?:spot|avg|average|overall))?/i,
    /([\d.]+)\s*USD\s*(?:per\s*)?kg/i,
    /([\d.]+)\s*\$\s*\/\s*kg/i,
  ];
  for (const pat of PATS) {
    const m = text.match(pat);
    if (m) { const n = parseFloat(m[1]); if (!isNaN(n) && n > 0.5 && n < 30) return n; }
  }
  return null;
}

async function fetchWorldAcdWeek(year, week) {
  const w   = String(week).padStart(2, '0');
  const url = `https://worldacd.com/trend-reports/weekly/worldacd-weekly-air-cargo-trends-${year}-week-${w}/`;
  const html = await fetchPage(url);
  if (!html) return null;
  return { label: `${year}-W${w}`, spot: extractSpotRate(stripHtml(html)), url };
}

async function fetchWorldAcd8Weeks() {
  const now  = new Date();
  const year = isoYear(now), week = isoWeek(now);
  const list = [];
  for (let i = 7; i >= 0; i--) {
    let w = week - i, y = year;
    if (w <= 0) { y = year - 1; w = 52 + w; }
    list.push({ y, w });
  }
  const results = [];
  for (const { y, w } of list) {
    const r = await fetchWorldAcdWeek(y, w);
    if (r?.spot != null) results.push(r);
  }
  return results;
}

// ── BAI ────────────────────────────────────────────────────────────────────────

async function fetchBai() {
  const html = await fetchPage('https://www.aircargoweek.com/market-data/');
  if (!html) return null;
  const text = stripHtml(html);
  for (const pat of [
    /BAI[- ]?00[^\d]{0,10}([\d,.]+)/i,
    /Baltic\s+Air\s+(?:Freight\s+)?Index[^\d]{0,20}([\d,.]+)/i,
    /TAC\s+Index[^\d]{0,20}([\d,.]+)/i,
    /BAI\s+([\d,.]+)/i,
  ]) {
    const m = text.match(pat);
    if (m) { const n = parseFloat(m[1].replace(/,/g, '')); if (!isNaN(n) && n > 50) return n; }
  }
  return null;
}

// ── Table builder ──────────────────────────────────────────────────────────────

function momArrow(curr, prev) {
  if (curr == null || prev == null || prev === 0) return '';
  const pct = ((curr - prev) / prev) * 100;
  const sym = pct > 0 ? '▲' : pct < 0 ? '▼' : '→';
  return ` ${sym}${Math.abs(pct).toFixed(1)}% MoM`;
}

// Build table from Superset multi-series chart data (TAC index routes)
function buildSupersetTable(chartData, month) {
  const header = '| 노선 | 최신값 (USD/kg) | 전월 대비 | 기준월 | 출처 |';
  const sep    = '|------|---------------|---------|--------|------|';
  const base   = process.env.SUPERSET_BASE || 'https://glip-bi.deepvue.vvnst.com';

  const rows = chartData.datasets.map(ds => {
    // Find the latest non-null value
    let curr = null, prev = null;
    for (let i = ds.data.length - 1; i >= 0; i--) {
      if (ds.data[i] != null) {
        if (curr == null) { curr = ds.data[i]; }
        else if (prev == null) { prev = ds.data[i]; break; }
      }
    }
    const lastLabel = chartData.labels[chartData.labels.length - 1] || month;
    const mom = momArrow(curr, prev);
    const val = curr != null ? curr.toFixed(2) : '—';
    return `| ${ds.label} | **${val}** | ${mom || '—'} | ${lastLabel} | [사내 BI](${base}) |`;
  });

  return [header, sep, ...rows].join('\n');
}

// Build table when Superset is not available (BAI + WorldACD only)
function buildFallbackTable(bai, worldAcdLatest) {
  const header = '| 지수 | 최신값 | 기준주차 | 출처 |';
  const sep    = '|------|--------|---------|------|';
  const rows   = [];
  if (worldAcdLatest?.spot != null)
    rows.push(`| WorldACD 글로벌 스팟 | **${worldAcdLatest.spot.toFixed(2)} USD/kg** | ${worldAcdLatest.label} | [WorldACD](${worldAcdLatest.url}) |`);
  if (bai != null)
    rows.push(`| BAI00 (발틱 항공운임지수) | **${bai.toFixed(0)}** | — | [aircargoweek.com](https://www.aircargoweek.com/market-data/) |`);
  if (!rows.length) return null;
  return [header, sep, ...rows].join('\n');
}

// ── Fact text for LLM ─────────────────────────────────────────────────────────

function buildFactText(chartData, bai, worldAcdLatest, source, month) {
  const lines = [];
  const today = new Date().toISOString().slice(0, 10);

  if (source === 'superset' && chartData) {
    lines.push('## TAC Index 항로별 운임 (사내 BI / Superset, USD/kg, 월별)');
    for (const ds of chartData.datasets) {
      const last = ds.data.filter(v => v != null).slice(-1)[0];
      if (last != null) lines.push(`${ds.label}: ${last.toFixed(2)} USD/kg`);
    }
  }
  if (worldAcdLatest?.spot != null)
    lines.push(`WorldACD 글로벌 스팟: ${worldAcdLatest.spot.toFixed(2)} USD/kg (${worldAcdLatest.label})`);
  if (bai != null)
    lines.push(`BAI00 (발틱 항공운임지수): ${bai.toFixed(0)}`);

  if (!lines.length) return '';
  lines.push(`(출처: ${source === 'superset' ? '사내 BI / Superset' : 'WorldACD·aircargoweek.com'}, ${today})`);
  return lines.join('\n');
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function buildAirIndices({ force = false } = {}) {
  if (!force) {
    const cached = loadCache();
    if (cached) {
      console.log(`  air-indices: 캐시 사용 (source=${cached.source}, ${cached.fetched_at.slice(0, 10)})`);
      return cached;
    }
  }

  const now   = new Date();
  const month = now.toISOString().slice(0, 7);
  const { slice_id, dashboard_id } = BI_CHARTS.air_index || {};

  // ── 1. Superset (primary) ──────────────────────────────────────────────────
  let chartData = null;
  let source    = 'worldacd';

  if (slice_id && dashboard_id) {
    console.log('  air-indices: Superset 수집 시도...');
    chartData = await fetchSupersetAirIndex({ sliceId: slice_id, dashboardId: dashboard_id });
    if (chartData) source = 'superset';
    else console.warn('  air-indices: Superset 실패 → WorldACD fallback');
  }

  // ── 2. WorldACD (fallback chart + always fetch for table reference) ────────
  let worldAcdLatest = null;
  if (!chartData) {
    console.log('  air-indices: WorldACD 8주 수집...');
    const weeks = await fetchWorldAcd8Weeks();
    if (weeks.length) {
      worldAcdLatest = weeks[weeks.length - 1];
      chartData = {
        labels:   weeks.map(w => w.label),
        datasets: [{
          label:           'WorldACD 글로벌 스팟 ($/kg)',
          data:            weeks.map(w => w.spot),
          borderColor:     '#2E86AB',
          backgroundColor: 'transparent',
          borderWidth: 2, pointRadius: 2, tension: 0.25, spanGaps: true,
        }],
      };
    }
  } else {
    // Superset OK — also grab WorldACD latest week for table reference
    const r = await fetchWorldAcdWeek(isoYear(now), isoWeek(now));
    if (r?.spot != null) worldAcdLatest = r;
  }

  // ── 3. BAI ─────────────────────────────────────────────────────────────────
  console.log('  air-indices: BAI 수집...');
  const bai = await fetchBai();
  if (bai) console.log(`  air-indices: BAI00 = ${bai.toFixed(0)}`);

  if (!chartData && !bai) {
    console.warn('  air-indices: 모든 소스 미수집 → null 반환');
    return null;
  }

  // ── 4. Build table + factText ──────────────────────────────────────────────
  let table;
  if (source === 'superset' && chartData) {
    table = buildSupersetTable(chartData, month);
    // Append BAI + WorldACD rows if available
    const extras = [];
    if (worldAcdLatest?.spot != null)
      extras.push(`| WorldACD 글로벌 스팟 | **${worldAcdLatest.spot.toFixed(2)} USD/kg** | ${worldAcdLatest.label} | — | [WorldACD](${worldAcdLatest.url}) |`);
    if (bai != null)
      extras.push(`| BAI00 | **${bai.toFixed(0)}** | — | — | [aircargoweek.com](https://www.aircargoweek.com/market-data/) |`);
    if (extras.length) table += '\n' + extras.join('\n');
  } else {
    table = buildFallbackTable(bai, worldAcdLatest) || '';
  }

  const factText = buildFactText(chartData, bai, worldAcdLatest, source, month);

  const payload = { source, chartData, table, factText };
  saveCache(payload);
  console.log(`  air-indices: 완료 (source=${source})`);
  return payload;
}

module.exports = { buildAirIndices, CACHE_PATH };
