'use strict';
// Blank Sailing data — 하이브리드 소스
//   • 추세 차트·region별 결항 선복(TEU): EconDB omissions-time-series (자동 백본)
//   • 헤드라인 결항 편수·East-West 항로 프레이밍: Drewry Cancelled Sailings Tracker (drewry-headline.js)
// 두 소스는 측정 대상이 다름 — EconDB=선복(TEU)/region, Drewry=편수(voyage)/항로. 보완 관계로 라벨을 정직히 구분.
// 결항률 분모는 proforma(=결항+실배선 선복). 'Actual capacity'(결항 후 실배선) 단독 분모는 결항률 과대.
// Cache: outputs/cache/blank-sailings.json  (TTL 7 days)

const path = require('path');
const fs   = require('fs');
const { buildDrewryHeadline } = require('./drewry-headline');

const CACHE_PATH  = path.resolve(__dirname, '../../../outputs/cache/blank-sailings.json');
const CACHE_TTL   = 7 * 24 * 60 * 60 * 1000;
const CACHE_SCHEMA = 3;
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

// EconDB region → 한국어 region 라벨 (출항 지역 단위; Drewry의 항로/얼라이언스와 다름 — 캡션에 명기)
const REGION_LABELS = {
  'East Asia':           '동아시아',
  'Mediterranean':       '지중해',
  'Northwest Europe':    '북서유럽',
  'North America East':  '북미 동안',
  'North America West':  '북미 서안',
  'Indian Subcontinent': '인도 아대륙',
  'Middle East':         '중동',
};

// ── Cache I/O ─────────────────────────────────────────────────────────────────

function loadCache() {
  try {
    if (!fs.existsSync(CACHE_PATH)) return null;
    const raw = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf-8'));
    if (raw.schema_version !== CACHE_SCHEMA) return null;
    if (Date.now() - new Date(raw.fetched_at).getTime() > CACHE_TTL) return null;
    return raw;
  } catch (_) { return null; }
}

function saveCache(payload) {
  try {
    fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
    fs.writeFileSync(
      CACHE_PATH,
      JSON.stringify({ schema_version: CACHE_SCHEMA, fetched_at: new Date().toISOString(), ...payload }, null, 2),
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
      const blankedRaw = item['Blanked capacity (TEU)'] ?? item['Blanked capacity'];
      const blanked = blankedRaw != null ? Number(blankedRaw) : null;
      const actual  = item['Actual capacity'] != null ? Number(item['Actual capacity']) : null;
      // 'Actual capacity'는 결항 후 실배선 선복 → 공시(공급) 선복 = proforma = 결항 + 실배선
      const planned = (blanked != null && actual != null) ? blanked + actual : actual;
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
  // Future rows are forecast placeholders. The monthly report must summarize
  // the latest available current-or-past week, not a future horizon endpoint.
  const today = new Date().toISOString().slice(0, 10);

  // Find latest publishable week with data across all regions.
  let latestWeek = '';
  for (const rows of Object.values(regionData)) {
    const last = [...rows].reverse().find(r => r.week_start <= today)?.week_start ?? '';
    if (last > latestWeek) latestWeek = last;
  }
  if (!latestWeek) return null;

  // Global TEU summary at (or closest to) latestWeek
  let totalBlanked = 0, totalPlanned = 0, blankedObservations = 0;
  for (const rows of Object.values(regionData)) {
    const row = [...rows].reverse().find(r => r.week_start <= latestWeek);
    if (row?.blanked != null) {
      totalBlanked += row.blanked;
      blankedObservations++;
    }
    if (row?.planned != null) totalPlanned += row.planned;
  }
  const pct = totalPlanned > 0 && blankedObservations > 0
    ? parseFloat(((totalBlanked / totalPlanned) * 100).toFixed(1))
    : null;
  if (pct == null) return null;

  // By-region breakdown (EconDB region 단위 — 항로 아님)
  const by_region = [];
  for (const [region, label] of Object.entries(REGION_LABELS)) {
    const rows = regionData[region];
    if (!rows?.length) continue;
    const row = [...rows].reverse().find(r => r.week_start <= latestWeek);
    if (row?.blank_pct != null) by_region.push({ region: label, pct: row.blank_pct });
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
    .filter(([ws]) => ws <= latestWeek)
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
    horizon_weeks: null,
    summary:       { scheduled: Math.round(totalPlanned), cancelled: Math.round(totalBlanked), pct },
    by_region,
    by_alliance:   [],           // Alliance·항로 분해는 EconDB로 불가 → Drewry 헤드라인으로 보완
    trend,
  };
}

// ── Renderers ─────────────────────────────────────────────────────────────────

function buildTable(data, drewry) {
  const { summary, by_region, as_of, url, trend } = data;

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
    ...by_region.map(t => '| ' + t.region + ' | — | — | ' + t.pct.toFixed(1) + '% | — |'),
  ];

  // Drewry 헤드라인(편수/항로) — EconDB 선복(TEU) 표와 측정 단위가 다름을 명시
  const drewryLine = drewry
    ? '> **Drewry 헤드라인** [2]: 동서 주요 항로 향후 ' + (drewry.horizon || 'N') + '주 ' +
      drewry.blank.toLocaleString('ko-KR') + '편 결항 / 예정 ' + drewry.scheduled.toLocaleString('ko-KR') +
      '편 (' + (drewry.pct != null ? drewry.pct.toFixed(1) + '%' : '—') + ', ' + drewry.asOf + ' 발표).'
    : null;

  const refs = ['', '**참고자료**', '[1] EconDB Omissions Time Series, ' + url];
  if (drewry) refs.push('[2] Drewry Cancelled Sailings Tracker, ' + drewry.asOf);

  return [
    '**결항 선복(TEU) — region별, 출처 EconDB** [1]',
    '',
    '| 지역(region) | 공급 선복(TEU) | 결항 선복(TEU) | 결항률(%) | 전주 대비 |',
    '|----------|-------------|-------------|---------|---------|',
    ...rows,
    '',
    ...(drewryLine ? [drewryLine, ''] : []),
    '※ ' + as_of + ' 기준 주간 데이터. region은 출항 지역 단위로, Drewry의 항로(Transpacific 등)·얼라이언스 분해와 다른 집계임.',
    ...refs,
  ].join('\n');
}

function buildFactText(data, drewry) {
  const { summary, by_region, as_of } = data;
  const lines = [];
  // 헤드라인은 Drewry(편수/항로) — 본문 헤드라인 수치로 우선 사용
  if (drewry) {
    lines.push(
      '[헤드라인·Drewry, 결항 편수 기준] 동서 주요 항로 향후 ' + (drewry.horizon || 'N') + '주 ' +
      drewry.blank + '편 결항 / 예정 ' + drewry.scheduled + '편' +
      (drewry.pct != null ? ' (' + drewry.pct.toFixed(1) + '%)' : '') + ', ' + drewry.asOf + ' 발표.'
    );
  }
  // 추세·region 분해는 EconDB(선복 TEU 기준)
  if (summary.pct != null) {
    lines.push(
      '[추세·EconDB, 결항 선복 TEU 기준] 전체 결항률 ' + summary.pct.toFixed(1) + '% (' + as_of + ' 기준 주간, ' +
      '결항 ' + (summary.cancelled != null ? summary.cancelled.toLocaleString('ko-KR') : '?') + ' TEU' +
      '/공급 ' + (summary.scheduled != null ? summary.scheduled.toLocaleString('ko-KR') : '?') + ' TEU)'
    );
  }
  for (const t of by_region) lines.push('  · ' + t.region + ' 결항률: ' + t.pct.toFixed(1) + '%');
  lines.push('(편수=Drewry, 선복 TEU=EconDB — 측정 단위 상이. region≠항로)');
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

  // Drewry 헤드라인(편수/항로) — 실패해도 EconDB 블록은 유지(빈 블록 방지)
  const drewry = await buildDrewryHeadline();

  const chartData = buildChartData(parsed.trend);
  const table     = buildTable(parsed, drewry);
  const factText  = buildFactText(parsed, drewry);

  const payload = { ...parsed, drewry, chartData, table, factText };
  saveCache(payload);
  console.log('  blank-sailings: 완료 (결항률 ' + parsed.summary.pct + '%, ' + parsed.as_of + ')');
  return payload;
}

module.exports = { buildBlankSailings, CACHE_PATH };
