'use strict';
// Blank Sailing data — EconDB omissions-time-series (primary source)
// Drewry Cancelled Sailings Tracker URL (/news/news/cancelled-sailings-tracker) returns 404
// as of 2026-06; replaced with EconDB free JSON API (same data used in collectors/blank_sailing.ts).
// Cache: outputs/cache/blank-sailings.json  (TTL 7 days)

const path = require('path');
const fs   = require('fs');

const CACHE_PATH  = path.resolve(__dirname, '../../../outputs/cache/blank-sailings.json');
const CACHE_TTL   = 7 * 24 * 60 * 60 * 1000;
const ECONDB_BASE = 'https://www.econdb.com/widgets/omissions-time-series/data/';
const SOURCE_NAME = 'EconDB Blank Sailing Tracker';
const SOURCE_URL  = 'https://www.econdb.com/widgets/omissions-time-series/';

const REGIONS = [
  'East Asia',
  'Mediterranean',
  'Northwest Europe',
  'North America East',
  'North America West',
  'Indian Subcontinent',
  'Middle East',
];

// EconDB regions → trade lane display names for the report table
const TRADE_LABELS = {
  'North America East': 'Transpacific EB / Transatlantic',
  'North America West': 'Transpacific WB',
  'Northwest Europe':   'Asia-N.Europe',
  'Mediterranean':      'Mediterranean',
};

// ── Cache I/O ─────────────────────────────────────────────────────────────────

function loadCache() {
  try {
    if (!fs.existsSync(CACHE_PATH)) return null;
    const raw = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf-8'));
    if (Date.now() - new Date(raw.fetched_at).getTime() > CACHE_TTL) return null;
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
  } catch (e) { console.warn('  blank-sailings: 캐시 저장 실패:', e.message); }
}

// ── EconDB fetch ──────────────────────────────────────────────────────────────

async function fetchRegion(region) {
  const url = `${ECONDB_BASE}?region=${encodeURIComponent(region)}`;
  const r = await fetch(url, {
    headers: { 'User-Agent': 'Logisight/1.0 (+https://logisight.mtlship.com)' },
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const data = await r.json();
  const items = data?.plots?.[0]?.data ?? [];
  return items
    .filter(item => item['Date'])
    .map(item => {
      const blanked = item['Blanked capacity'] != null ? Number(item['Blanked capacity']) : null;
      const planned = item['Actual capacity']  != null ? Number(item['Actual capacity'])  : null;
      const blank_pct = blanked != null && planned != null && planned > 0
        ? parseFloat(((blanked / planned) * 100).toFixed(1))
        : null;
      return { week_start: String(item['Date']), blanked, planned, blank_pct };
    });
}

// ── Aggregation ───────────────────────────────────────────────────────────────

function isoWeek(dateStr) {
  const d    = new Date(dateStr + 'T00:00:00Z');
  const jan4 = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  return Math.ceil(((d - jan4) / 86400000 + jan4.getUTCDay() + 1) / 7);
}

function aggregate(regionData) {
  // Find latest week with data across all regions
  let latestWeek = '';
  for (const rows of Object.values(regionData)) {
    const last = rows[rows.length - 1]?.week_start ?? '';
    if (last > latestWeek) latestWeek = last;
  }
  if (!latestWeek) return null;

  // Global TEU summary at (or closest to) latestWeek
  let totalBlanked = 0, totalPlanned = 0;
  for (const rows of Object.values(regionData)) {
    const row = [...rows].reverse().find(r => r.week_start <= latestWeek);
    if (row?.blanked != null) totalBlanked += row.blanked;
    if (row?.planned != null) totalPlanned += row.planned;
  }
  const pct = totalPlanned > 0
    ? parseFloat(((totalBlanked / totalPlanned) * 100).toFixed(1))
    : null;
  if (pct == null) return null;

  // By-trade breakdown
  const by_trade = [];
  for (const [region, label] of Object.entries(TRADE_LABELS)) {
    const rows = regionData[region];
    if (!rows?.length) continue;
    const row = [...rows].reverse().find(r => r.week_start <= latestWeek);
    if (row?.blank_pct != null) by_trade.push({ trade: label, pct: row.blank_pct });
  }

  // Weekly trend: sum all regions per week, keep last 8
  const weekMap = {};
  for (const rows of Object.values(regionData)) {
    for (const row of rows) {
      if (!weekMap[row.week_start]) weekMap[row.week_start] = { b: 0, p: 0 };
      if (row.blanked != null) weekMap[row.week_start].b += row.blanked;
      if (row.planned != null) weekMap[row.week_start].p += row.planned;
    }
  }
  const trend = Object.entries(weekMap)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-8)
    .map(([ws, { b, p }]) => ({
      week:  isoWeek(ws),
      as_of: ws,
      pct:   p > 0 ? parseFloat(((b / p) * 100).toFixed(1)) : null,
    }))
    .filter(r => r.pct != null);

  return {
    as_of:         latestWeek,
    source:        SOURCE_NAME,
    url:           SOURCE_URL,
    horizon_weeks: null,         // EconDB is historical, not forward-looking
    summary:       { scheduled: Math.round(totalPlanned), cancelled: Math.round(totalBlanked), pct },
    by_trade,
    by_alliance:   [],           // Alliance-level breakdown not available from EconDB
    trend,
  };
}

// ── Renderers ─────────────────────────────────────────────────────────────────

function buildTable(data) {
  const { summary, by_trade, as_of, url, trend } = data;

  let wowStr = '—';
  if (Array.isArray(trend) && trend.length >= 2) {
    const diff = trend[trend.length - 1].pct - trend[trend.length - 2].pct;
    const sym  = diff > 0 ? '▲' : diff < 0 ? '▼' : '→';
    wowStr = sym + Math.abs(diff).toFixed(1) + '%p';
  }

  const pct = summary.pct != null ? '**' + summary.pct.toFixed(1) + '%**' : '—';
  const sch = summary.scheduled != null ? summary.scheduled.toLocaleString('ko-KR') + ' TEU' : '—';
  const cnl = summary.cancelled  != null ? summary.cancelled.toLocaleString('ko-KR')  + ' TEU' : '—';

  const rows = [
    '| **전체 (' + as_of + ' 기준)** | **' + sch + '** | **' + cnl + '** | ' + pct + ' | ' + wowStr + ' |',
    ...by_trade.map(t => '| ' + t.trade + ' | — | — | ' + t.pct.toFixed(1) + '% | — |'),
  ];

  return [
    '| 항로/구분 | 예정 선복(TEU) | 결항 선복(TEU) | 결항률(%) | 전주 대비 |',
    '|----------|-------------|-------------|---------|---------|',
    ...rows,
    '',
    '※ ' + as_of + ' 기준 주간 데이터. 출처: [' + SOURCE_NAME + '](' + url + ').',
  ].join('\n');
}

function buildFactText(data) {
  const { summary, by_trade, as_of } = data;
  const lines = [];
  if (summary.pct != null) {
    lines.push(
      '전체 결항률: ' + summary.pct.toFixed(1) + '% (' + as_of + ' 기준 주간, ' +
      'EconDB 집계 결항 ' + (summary.cancelled != null ? summary.cancelled.toLocaleString('ko-KR') : '?') + ' TEU' +
      '/' + (summary.scheduled != null ? summary.scheduled.toLocaleString('ko-KR') : '?') + ' TEU)'
    );
  }
  for (const t of by_trade) lines.push(t.trade + ': ' + t.pct.toFixed(1) + '%');
  lines.push('(출처: ' + SOURCE_NAME + ', ' + as_of + ')');
  return lines.join('\n');
}

function buildChartData(trend) {
  if (!trend || trend.length < 2) return null;
  return {
    labels: trend.map(p => 'W' + p.week),
    datasets: [{
      label: '전체 결항률 (%)',
      data: trend.map(p => p.pct),
      borderColor: '#BC4749',
      backgroundColor: 'rgba(188,71,73,0.1)',
      borderWidth: 2, pointRadius: 3, tension: 0.25, spanGaps: true, fill: true,
    }],
  };
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function buildBlankSailings({ force = false } = {}) {
  if (!force) {
    const cached = loadCache();
    if (cached) {
      console.log('  blank-sailings: 캐시 사용 (' + cached.as_of + ')');
      return cached;
    }
  }

  console.log('  blank-sailings: EconDB 수집 중 (' + REGIONS.length + '개 지역)...');

  const regionData = {};
  for (const region of REGIONS) {
    try {
      const rows = await fetchRegion(region);
      if (rows.length) regionData[region] = rows;
      console.log(`  blank-sailings: [${region}] ${rows.length}주`);
    } catch (e) {
      console.warn(`  blank-sailings: [${region}] 실패 —`, e.message);
    }
  }

  if (!Object.keys(regionData).length) {
    console.warn('  blank-sailings: 모든 지역 수집 실패');
    return null;
  }

  const parsed = aggregate(regionData);
  if (!parsed) {
    console.warn('  blank-sailings: 집계 실패 (데이터 없음)');
    return null;
  }

  const chartData = buildChartData(parsed.trend);
  const table     = buildTable(parsed);
  const factText  = buildFactText(parsed);

  const payload = { ...parsed, chartData, table, factText };
  saveCache(payload);
  console.log('  blank-sailings: 완료 (결항률 ' + parsed.summary.pct + '%, ' + parsed.as_of + ')');
  return payload;
}

module.exports = { buildBlankSailings, CACHE_PATH };
