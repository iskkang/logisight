'use strict';
// Container Port Throughput Index
// Primary:  ISL Container Throughput Index — https://www.isl.org/en/containerindex
// Fallback: RWI-ISL press release page
// Cache:    outputs/cache/port-throughput.json (TTL 7 days)
// Trend:    accumulated monthly (last 8 months)

const path = require('path');
const fs   = require('fs');

const CACHE_PATH = path.resolve(__dirname, '../../../outputs/cache/port-throughput.json');
const CACHE_TTL  = 7 * 24 * 60 * 60 * 1000;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const ISL_BASE = 'https://www.isl.org';
const SOURCES = [
  {
    key:      'ISL',
    url:      'https://www.isl.org/en/services/rwiisl-container-throughput-index',
    label:    'RWI/ISL Container Throughput Index',
    discover: discoverLatestIsl,   // 랜딩엔 수치가 없음 → 최신 월 보도자료 링크 추적
  },
  {
    key:   'RWI-ISL',
    url:   'https://www.rwi-essen.de/en/research-advice/research-unit/macroeconomics-and-public-finance/hightlight-topic/rwi-isl-container-throughput-index',
    label: 'RWI/ISL Container Throughput Index',
  },
];

// 랜딩 페이지에서 최신 월별 보도자료 링크 발견.
// href 패턴: /en/services/rwiisl-container-throughput-index-<M><YY> (예 -526 = 2026-05).
function discoverLatestIsl(landingHtml) {
  const re = /\/en\/services\/rwiisl-container-throughput-index-(\d{3,4})\b/gi;
  const slugs = [];
  let m;
  while ((m = re.exec(landingHtml)) !== null) slugs.push(m[1]);
  if (!slugs.length) return null;
  const rank = s => (+s.slice(-2)) * 100 + (+s.slice(0, -2));   // (YY*100 + M) 최신 우선
  const best = slugs.sort((a, b) => rank(b) - rank(a))[0];
  return ISL_BASE + '/en/services/rwiisl-container-throughput-index-' + best;
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

function loadCacheRaw() {
  try {
    if (!fs.existsSync(CACHE_PATH)) return null;
    return JSON.parse(fs.readFileSync(CACHE_PATH, 'utf-8'));
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
  } catch (e) { console.warn('  port-throughput: 캐시 저장 실패:', e.message); }
}

// ── HTTP + parse ──────────────────────────────────────────────────────────────

async function fetchPage(url) {
  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'text/html,*/*' },
      signal: AbortSignal.timeout(20000),
    });
    if (!r.ok) { console.warn('  port-throughput: HTTP ' + r.status + ' ← ' + url); return null; }
    return await r.text();
  } catch (e) {
    console.warn('  port-throughput: fetch 오류 — ' + e.message);
    return null;
  }
}

function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ');
}

function parseIndexValue(text) {
  const PATS = [
    // "to 141.9 index points" (ISL 보도자료 표현) — "index points" 바로 앞 수치
    /(\d{2,3}\.\d+)\s+index\s+points?/i,
    // "Container Throughput Index ... 138.2"
    /(?:container\s+throughput\s+index|CTI)[^0-9]{0,80}(\d{2,3}\.?\d+)/i,
    // "index stood at 138.2 points"
    /index\s+(?:stood|stands?|reached?|was|is)\s+at\s+(\d{2,3}\.?\d*)/i,
    // "138.2 points" (generic)
    /(\d{2,3}\.\d+)\s+points?/i,
    // "value of 138.2" or "level of 138.2"
    /(?:value|level)\s+of\s+(\d{2,3}\.?\d*)/i,
  ];
  for (const pat of PATS) {
    const m = text.match(pat);
    if (m) {
      const n = parseFloat(m[1]);
      if (n > 80 && n < 250) return n;
    }
  }
  return null;
}

function parseYoY(text) {
  const m = text.match(/(?:year.on.year|y\.?o\.?y|year.over.year)[^%\d]{0,50}([+-]?\d+\.?\d*)\s*%/i)
         || text.match(/([+-]?\d+\.?\d*)\s*%[^.]{0,60}(?:compared\s+to[^.]{0,30}(?:previous|prior|last)\s+year|year.on.year|y\.?o\.?y)/i);
  if (m) { const n = parseFloat(m[1]); if (!isNaN(n) && Math.abs(n) < 50) return n; }
  return null;
}

function parseMoM(text) {
  const m = text.match(/(?:month.on.month|m\.?o\.?m)[^%\d]{0,50}([+-]?\d+\.?\d*)\s*%/i)
         || text.match(/([+-]?\d+\.?\d*)\s*%[^.]{0,40}(?:month.on.month|m\.?o\.?m)/i);
  if (m) { const n = parseFloat(m[1]); if (!isNaN(n) && Math.abs(n) < 30) return n; }
  return null;
}

// "from A (revised) to B" → 직전월 A / 당월 B (명시적 MoM% 없을 때 계산 근거)
function parseFromTo(text) {
  const m = text.match(/from\s+(\d{2,3}\.\d+)\s*(?:\(revised\)\s*)?to\s+(\d{2,3}\.\d+)/i);
  if (!m) return null;
  const prev = parseFloat(m[1]);
  const curr = parseFloat(m[2]);
  if (!(prev > 80 && curr > 80)) return null;
  return { prev, curr };
}

function parseHtml(html) {
  const text = stripHtml(html);
  const index = parseIndexValue(text);
  if (!index) return null;
  let mom = parseMoM(text);
  if (mom == null) {
    const ft = parseFromTo(text);   // 보도자료가 % 대신 "from A to B"만 줄 때 계산
    if (ft) mom = ((ft.curr - ft.prev) / ft.prev) * 100;
  }
  return { index, yoy_pct: parseYoY(text), mom_pct: mom };
}

// ── Trend accumulation ────────────────────────────────────────────────────────

function currentMonth() { return new Date().toISOString().slice(0, 7); }

function mergeTrend(current, oldCache) {
  const month = currentMonth();
  const newPt = { month, index: current.index, yoy_pct: current.yoy_pct };
  const old   = Array.isArray(oldCache?.trend) ? oldCache.trend : [];
  const byMonth = {};
  for (const p of [...old, newPt]) {
    if (p.index != null) byMonth[p.month] = p;
  }
  return Object.values(byMonth).sort((a, b) => a.month.localeCompare(b.month)).slice(-8);
}

// ── Renderers ─────────────────────────────────────────────────────────────────

function buildTable(data) {
  const { index, mom_pct, yoy_pct, as_of, source_label, source_url, by_region } = data;

  const idxStr = index  != null ? index.toFixed(1) : '—';
  const momStr = mom_pct != null
    ? (mom_pct >= 0 ? '▲' : '▼') + Math.abs(mom_pct).toFixed(1) + '%'
    : '—';
  const yoyStr = yoy_pct != null
    ? (yoy_pct >= 0 ? '▲' : '▼') + Math.abs(yoy_pct).toFixed(1) + '% YoY'
    : '—';

  const rows = [
    '| **글로벌 종합** | **' + idxStr + '** | ' + momStr + ' | ' + yoyStr + ' |',
    ...(by_region || []).map(r => {
      const ryoy = r.yoy_pct != null
        ? (r.yoy_pct >= 0 ? '▲' : '▼') + Math.abs(r.yoy_pct).toFixed(1) + '% YoY'
        : '—';
      return '| ' + r.region + ' | — | — | ' + ryoy + ' |';
    }),
  ];

  const srcNote = '\n※ ' + as_of + ' 기준. 출처: [' + source_label + '](' + source_url + ').';
  return [
    '| 지역 | 지수 | 전월 대비 | YoY |',
    '|------|------|---------|-----|',
    ...rows,
    '',
    srcNote,
  ].join('\n');
}

function buildFactText(data) {
  const { index, mom_pct, yoy_pct, by_region, as_of, source_label } = data;
  const lines = [];
  if (index  != null) lines.push('글로벌 컨테이너 항만 처리량 지수: ' + index.toFixed(1));
  if (mom_pct != null) lines.push('전월 대비: ' + (mom_pct >= 0 ? '+' : '') + mom_pct.toFixed(1) + '%');
  if (yoy_pct != null) lines.push('전년 동기 대비 YoY: ' + (yoy_pct >= 0 ? '+' : '') + yoy_pct.toFixed(1) + '%');
  for (const r of (by_region || [])) {
    if (r.yoy_pct != null)
      lines.push(r.region + ': YoY ' + (r.yoy_pct >= 0 ? '+' : '') + r.yoy_pct.toFixed(1) + '%');
  }
  lines.push('(출처: ' + source_label + ', ' + as_of + ')');
  return lines.join('\n');
}

function buildChartData(trend) {
  if (!trend || trend.length < 2) return null;
  return {
    labels: trend.map(p => p.month),
    datasets: [{
      label: '컨테이너 항만 처리량 지수',
      data: trend.map(p => p.index),
      borderColor: '#1E3A5F',
      backgroundColor: 'rgba(30,58,95,0.1)',
      borderWidth: 2, pointRadius: 3, tension: 0.25, spanGaps: true, fill: true,
    }],
  };
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function buildPortThroughput({ force = false } = {}) {
  if (!force) {
    const cached = loadCache();
    if (cached) { console.log('  port-throughput: 캐시 사용 (' + cached.as_of + ')'); return cached; }
  }

  let parsed = null;
  let source = null;
  for (const src of SOURCES) {
    console.log('  port-throughput: ' + src.key + ' 수집 시도...');
    const html = await fetchPage(src.url);
    if (!html) continue;
    let usedUrl = src.url;
    parsed = parseHtml(html);
    if (!parsed && src.discover) {
      const latestUrl = src.discover(html);   // 랜딩에 수치 없으면 최신 월 보도자료로
      if (latestUrl) {
        console.log('  port-throughput: 최신 월 링크 발견 → ' + latestUrl);
        const artHtml = await fetchPage(latestUrl);
        if (artHtml) { parsed = parseHtml(artHtml); usedUrl = latestUrl; }
      }
    }
    if (parsed) { source = { ...src, url: usedUrl }; break; }
  }

  if (!parsed) {
    console.warn('  port-throughput: 모든 소스 파싱 실패 (JS 렌더링 가능)');
    return null;
  }

  const oldCache  = loadCacheRaw();
  const trend     = mergeTrend(parsed, oldCache);
  const chartData = buildChartData(trend);

  const data = {
    as_of:         new Date().toISOString().slice(0, 10),
    source_key:    source.key,
    source_label:  source.label,
    source_url:    source.url,
    index:         parsed.index,
    mom_pct:       parsed.mom_pct,
    yoy_pct:       parsed.yoy_pct,
    by_region:     [],
    trend,
  };

  const table    = buildTable(data);
  const factText = buildFactText(data);

  const payload = { ...data, chartData, table, factText };
  saveCache(payload);
  console.log('  port-throughput: 완료 (index=' + parsed.index + ', source=' + source.key + ')');
  return payload;
}

module.exports = { buildPortThroughput, CACHE_PATH, parseIndexValue, parseFromTo, discoverLatestIsl };
