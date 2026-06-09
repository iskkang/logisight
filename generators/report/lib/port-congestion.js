'use strict';
// Port Congestion (median vessel waiting time) — Portcast 공개 항만 페이지 파싱.
// 출처: https://www.portcast.io/port-congestion/{slug}  (주간 갱신, 무료 공개)
// port-throughput.js와 동일 패턴: cache-first + 주간 추이 누적 + per-source 에러격리.
//
// ⚠️ 공개 페이지는 "이번주/지난주 median 대기일 + 카테고리"만 노출(다주 차트는 유료).
//    → 매주 수집해 캐시에 누적하면 MCI식 추이가 형성된다(mergeTrend, 항만별 최근 12주).
// ⚠️ portcast.io는 샌드박스 네트워크 차단 → 로컬 테스트 필수.
//
// 페이지 개요 문장(실제 구조, 2026-06 확인):
//   "{Port} shows {low|medium|high} congestion with median waiting times at {X} days
//    ({±Y}% week-over-week)[ and exhibiting long tail congestion]"
//   "Congestion Category {Low|Medium|High}" / "Long Tail Congestion {Yes|No}"

const path = require('path');
const fs   = require('fs');

const CACHE_PATH = path.resolve(__dirname, '../../../outputs/cache/port-congestion.json');
const CACHE_TTL  = 7 * 24 * 60 * 60 * 1000;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// MTL 관련 항만(원양·유럽·발틱(CIS 게이트웨이)·중동 환적·아시아 출발). slug는 portcast URL 기준.
const PORTS = [
  { slug: 'long-beach',  name: 'Long Beach',  region: '북미' },
  { slug: 'los-angeles', name: 'Los Angeles', region: '북미' },
  { slug: 'new-york',    name: 'New York',    region: '북미' },
  { slug: 'rotterdam',   name: 'Rotterdam',   region: '유럽' },
  { slug: 'hamburg',     name: 'Hamburg',     region: '유럽' },
  { slug: 'gdansk',      name: 'Gdansk',      region: '발틱' },
  { slug: 'singapore',   name: 'Singapore',   region: '아시아' },
  { slug: 'shanghai',    name: 'Shanghai',    region: '아시아' },
  { slug: 'ningbo',      name: 'Ningbo',      region: '아시아' },
  { slug: 'busan',       name: 'Busan',       region: '아시아' },
  { slug: 'jebel-ali',   name: 'Jebel Ali',   region: '중동' },
];

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ── Cache I/O ─────────────────────────────────────────────────────────────────
function loadCache() {
  try {
    if (!fs.existsSync(CACHE_PATH)) return null;
    const raw = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf-8'));
    if (Date.now() - new Date(raw.fetched_at).getTime() > CACHE_TTL) return null;
    return raw;
  } catch (_) { return null; }
}
function loadCacheRaw() {
  try { return fs.existsSync(CACHE_PATH) ? JSON.parse(fs.readFileSync(CACHE_PATH, 'utf-8')) : null; }
  catch (_) { return null; }
}
function saveCache(payload) {
  try {
    fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
    fs.writeFileSync(CACHE_PATH, JSON.stringify({ fetched_at: new Date().toISOString(), ...payload }, null, 2), 'utf-8');
  } catch (e) { console.warn('  port-congestion: 캐시 저장 실패:', e.message); }
}

// ── HTTP + parse ────────────────────────────────────────────────────────────────
async function fetchPage(url) {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html,*/*' }, signal: AbortSignal.timeout(20000) });
    if (!r.ok) { console.warn('  port-congestion: HTTP ' + r.status + ' ← ' + url); return null; }
    return await r.text();
  } catch (e) { console.warn('  port-congestion: fetch 오류 — ' + e.message); return null; }
}
function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');
}

// 개요 문장 우선 파싱 — category·median·WoW·long-tail이 한 문장에 있음.
function parsePortPage(html, port) {
  const text = stripHtml(html);

  // 개요: "... shows {cat} congestion with median waiting times at {X} days ({±Y}% week-over-week)..."
  const ov = text.match(/shows\s+(low|medium|high)\s+congestion\s+with\s+median\s+waiting\s+times?\s+at\s+([\d.]+)\s+days\s*\(\s*([+-]?\s*[\d.]+)\s*%\s*week-over-week\)/i);

  let category = ov ? ov[1].toLowerCase() : null;
  let median   = ov ? parseFloat(ov[2]) : null;
  let wow      = ov ? parseFloat(ov[3].replace(/\s+/g, '')) : null;

  // fallback: 라벨 기반
  if (category == null) {
    const c = text.match(/Congestion\s+Category\s+(Low|Medium|High)/i);
    if (c) category = c[1].toLowerCase();
  }
  if (median == null) {
    const m = text.match(/median\s+waiting\s+times?\s+(?:at|of)\s+([\d.]+)\s+days/i);
    if (m) median = parseFloat(m[1]);
  }
  // 라이브 페이지 포맷(숫자 선행): "0.13 days as the median waiting time"
  if (median == null) {
    const m = text.match(/([\d.]+)\s+days?\s+as\s+the\s+median\s+waiting\s+time/i);
    if (m) median = parseFloat(m[1]);
  }
  const longTail = /exhibiting\s+long\s+tail\s+congestion/i.test(text)
                || /Long\s+Tail\s+Congestion\s+Yes/i.test(text);

  // 기준 주(헤더 괄호): "Port Congestion at X, Y (23-29 Mar 2026)"
  const wk = text.match(/Port\s+Congestion\s+at[^()]*\(([^)]+)\)/i);
  const week_label = wk ? wk[1].trim() : new Date().toISOString().slice(0, 10);

  if (median == null && category == null) return null; // 아무것도 못 잡으면 실패
  return {
    port: port.name, slug: port.slug, region: port.region,
    median_wait_days: median, wow_pct: (Number.isFinite(wow) ? Math.round(wow * 10) / 10 : null),
    category, long_tail: longTail, week_label,
  };
}

// ── Trend accumulation (항만별 최근 12주) ────────────────────────────────────────
function mergeTrend(latestByPort, oldCache) {
  const old = (oldCache && oldCache.trend) || {};
  const out = {};
  for (const slug of new Set([...Object.keys(old), ...Object.keys(latestByPort)])) {
    const series = Array.isArray(old[slug]) ? old[slug].slice() : [];
    const cur = latestByPort[slug];
    if (cur && cur.median_wait_days != null) {
      const idx = series.findIndex(p => p.week_label === cur.week_label);
      const pt  = { week_label: cur.week_label, median_wait_days: cur.median_wait_days, category: cur.category };
      if (idx >= 0) series[idx] = pt; else series.push(pt);
    }
    out[slug] = series.slice(-12);
  }
  return out;
}

// ── Renderers ─────────────────────────────────────────────────────────────────
const CAT_KO = { low: '낮음', medium: '보통', high: '높음' };
function fmtWow(x) { return x == null ? '—' : (x >= 0 ? '▲' : '▼') + Math.abs(x).toFixed(0) + '%'; }

function buildTable(rows, asOf) {
  const ok = rows.filter(r => r.ok && r.median_wait_days != null)
                 .sort((a, b) => b.median_wait_days - a.median_wait_days);
  if (!ok.length) return null;
  const body = ok.map(r =>
    `| ${r.port} (${r.region}) | ${r.median_wait_days.toFixed(1)}일 | ${fmtWow(r.wow_pct)} | ${CAT_KO[r.category] || r.category || '—'}${r.long_tail ? ' · 롱테일' : ''} |`
  );
  return [
    '| 항만 | median 대기 | WoW | 혼잡도 |',
    '|------|-----------|-----|--------|',
    ...body,
    '',
    `※ ${asOf} 기준. 출처: [Portcast Port Congestion](https://www.portcast.io/port-congestion). median = 입항 전 정박/대기 일수 중앙값.`,
  ].join('\n');
}

function buildChartData(trend) {
  const slugs = Object.keys(trend).filter(s => (trend[s] || []).length >= 2);
  if (!slugs.length) return null;
  const labels = [...new Set([].concat(...slugs.map(s => trend[s].map(p => p.week_label))))];
  const palette = ['#1E3A5F', '#C9A24B', '#6B8E9E', '#B5651D', '#7A8450', '#9E5B6B'];
  return {
    labels,
    datasets: slugs.slice(0, 6).map((s, i) => {
      const byWk = Object.fromEntries(trend[s].map(p => [p.week_label, p.median_wait_days]));
      return {
        label: (PORTS.find(p => p.slug === s) || {}).name || s,
        data: labels.map(l => (l in byWk ? byWk[l] : null)),
        borderColor: palette[i % palette.length], borderWidth: 2, pointRadius: 2, tension: 0.25, spanGaps: true, fill: false,
      };
    }),
  };
}

function buildFactText(rows, asOf) {
  const ok = rows.filter(r => r.ok && r.median_wait_days != null);
  if (!ok.length) return null;
  const lines = ['항만 혼잡도(median 대기일, ' + asOf + ', Portcast):'];
  for (const r of ok.sort((a, b) => b.median_wait_days - a.median_wait_days)) {
    lines.push(`${r.port}: ${r.median_wait_days.toFixed(1)}일 (WoW ${fmtWow(r.wow_pct)}, ${CAT_KO[r.category] || r.category})`);
  }
  return lines.join('\n');
}

// ── Main ────────────────────────────────────────────────────────────────────────
async function buildPortCongestion({ force = false } = {}) {
  if (!force) {
    const cached = loadCache();
    if (cached) { console.log('  port-congestion: 캐시 사용 (' + cached.as_of + ')'); return cached; }
  }

  const rows = [];
  for (const port of PORTS) {
    try {
      const html = await fetchPage('https://www.portcast.io/port-congestion/' + port.slug);
      if (!html) { rows.push({ ...port, port: port.name, ok: false }); await sleep(1200); continue; }
      const parsed = parsePortPage(html, port);
      if (parsed) { rows.push({ ...parsed, ok: true }); console.log(`  port-congestion: ${port.name} OK (${parsed.median_wait_days}일, ${parsed.category})`); }
      else        { rows.push({ ...port, port: port.name, ok: false }); console.warn(`  port-congestion: ${port.name} 파싱 실패`); }
    } catch (e) {
      rows.push({ ...port, port: port.name, ok: false });
      console.warn(`  port-congestion: ${port.name} 실패 — ${e.message}`);
    }
    await sleep(1200); // rate limit
  }

  const okRows = rows.filter(r => r.ok);
  if (!okRows.length) { console.warn('  port-congestion: 전 항만 미수집 — null 반환'); return null; }

  const asOf = new Date().toISOString().slice(0, 10);
  const latestByPort = Object.fromEntries(okRows.map(r => [r.slug, r]));
  const trend = mergeTrend(latestByPort, loadCacheRaw());

  const data = { as_of: asOf, rows, trend };
  const table     = buildTable(rows, asOf);
  const chartData = buildChartData(trend);
  const factText  = buildFactText(rows, asOf);

  const payload = { ...data, table, chartData, factText };
  saveCache(payload);
  console.log(`  port-congestion: 완료 (${okRows.length}/${PORTS.length}개 항만)`);
  return payload;
}

module.exports = { buildPortCongestion, parsePortPage, PORTS, CACHE_PATH };