'use strict';
// Drewry Cancelled Sailings Tracker — blank sailing data for the ocean section.
// Priority: Drewry tracker direct fetch → parse → cache
// Cache:    outputs/cache/blank-sailings.json  (TTL 7 days)
// Trend:    accumulated from previous cache runs (last 8 ISO weeks)

const path = require('path');
const fs   = require('fs');

const CACHE_PATH = path.resolve(__dirname, '../../../outputs/cache/blank-sailings.json');
const CACHE_TTL  = 7 * 24 * 60 * 60 * 1000;
const DREWRY_URL = 'https://www.drewry.co.uk/news/news/cancelled-sailings-tracker';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// ── Helpers ───────────────────────────────────────────────────────────────────

function currentIsoWeek() {
  const now = new Date();
  const d   = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const jan1 = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - jan1) / 86400000) + 1) / 7);
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
  } catch (e) { console.warn('  blank-sailings: 캐시 저장 실패:', e.message); }
}

// ── HTTP ──────────────────────────────────────────────────────────────────────

async function fetchPage() {
  try {
    const r = await fetch(DREWRY_URL, {
      headers: { 'User-Agent': UA, Accept: 'text/html,*/*' },
      signal: AbortSignal.timeout(20000),
    });
    if (!r.ok) { console.warn(`  blank-sailings: HTTP ${r.status}`); return null; }
    return await r.text();
  } catch (e) {
    console.warn('  blank-sailings: fetch 오류 —', e.message);
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
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ');
}

// ── Parsers ───────────────────────────────────────────────────────────────────

// Try Next.js __NEXT_DATA__ JSON for scheduled/cancelled pair
function tryNextData(html) {
  const m = html.match(/<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return null;
  try {
    const str = m[1];
    const sm  = str.match(/"scheduled"\s*:\s*(\d+)[^}]{0,80}"cancelled"\s*:\s*(\d+)/);
    if (sm) {
      const scheduled = parseInt(sm[1]);
      const cancelled = parseInt(sm[2]);
      if (scheduled > 0 && cancelled <= scheduled)
        return { scheduled, cancelled, pct: parseFloat(((cancelled / scheduled) * 100).toFixed(1)) };
    }
  } catch (_) {}
  return null;
}

function extractSummary(text) {
  const PATS = [
    // "47 of 707 scheduled sailings (6.6%)"
    {
      re: /(\d+)\s+of\s+([\d,]+)\s+scheduled\s+sailings?[^(]{0,30}\(([\d.]+)%\)/i,
      fn: (m) => ({ cancelled: parseInt(m[1]), scheduled: parseInt(m[2].replace(/,/g, '')), pct: parseFloat(m[3]) }),
    },
    // "707 scheduled sailings ... 47 ... cancelled"
    {
      re: /([\d,]+)\s+scheduled\s+sailings?[\s\S]{0,80}?(\d+)[^%\d]{0,20}(?:are|were|have been)\s+cancelled/i,
      fn: (m) => {
        const s = parseInt(m[1].replace(/,/g, ''));
        const c = parseInt(m[2]);
        return { scheduled: s, cancelled: c, pct: s > 0 ? parseFloat(((c / s) * 100).toFixed(1)) : null };
      },
    },
    // "6.6% of ... scheduled sailings ... cancelled"
    {
      re: /([\d.]+)%\s+of\s+(?:the\s+)?[\d,]+\s+scheduled\s+sailings?[^.]{0,50}cancelled/i,
      fn: (m) => ({ scheduled: null, cancelled: null, pct: parseFloat(m[1]) }),
    },
    // "cancelled: 47 ... scheduled: 707"
    {
      re: /cancelled[:\s]*([\d,]+)[\s\S]{0,80}scheduled[:\s]*([\d,]+)/i,
      fn: (m) => {
        const c = parseInt(m[1].replace(/,/g, ''));
        const s = parseInt(m[2].replace(/,/g, ''));
        return { cancelled: c, scheduled: s, pct: s > 0 ? parseFloat(((c / s) * 100).toFixed(1)) : null };
      },
    },
  ];
  for (const { re, fn } of PATS) {
    const m = text.match(re);
    if (m) {
      const r = fn(m);
      if (r.pct != null && r.pct >= 0 && r.pct <= 60) return r;
    }
  }
  return null;
}

function extractHorizon(text) {
  const m = text.match(/(?:next|rolling|coming|upcoming)\s+([\d]+)\s*weeks?/i)
         || text.match(/([\d]+)\s*weeks?\s+(?:ahead|forward|rolling|horizon)/i);
  return m ? parseInt(m[1]) : null;
}

function extractByTrade(text) {
  const TRADES = [
    {
      key: 'Transpacific EB',
      pats: [
        /transpacific\s*(?:east.?bound|EB)[^%\d]{0,40}([\d.]+)\s*%/i,
        /Asia[- ](?:US|North\s*America|USWC|USEC)[^%\d]{0,40}([\d.]+)\s*%/i,
      ],
    },
    {
      key: 'Asia-N.Europe/Med',
      pats: [
        /Asia[- ](?:N(?:orth)?\.?\s*Eu|Northern\s*Europe|Europe\/Med|Med)[^%\d]{0,40}([\d.]+)\s*%/i,
        /Far\s*East[- ](?:Europe|Med)[^%\d]{0,40}([\d.]+)\s*%/i,
      ],
    },
    {
      key: 'Transatlantic WB',
      pats: [
        /transatlantic\s*(?:west.?bound|WB)[^%\d]{0,40}([\d.]+)\s*%/i,
      ],
    },
  ];
  const result = [];
  for (const { key, pats } of TRADES) {
    for (const pat of pats) {
      const m = text.match(pat);
      if (m) { result.push({ trade: key, pct: parseFloat(m[1]) }); break; }
    }
  }
  return result;
}

function extractByAlliance(text) {
  const NAMES = ['Gemini', 'MSC', 'Ocean Alliance', 'Premier Alliance'];
  const result = [];
  for (const name of NAMES) {
    const safe = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const m = text.match(new RegExp(safe + '[^%\\d]{0,50}?([\\d.]+)\\s*%', 'i'));
    if (m) result.push({ name, share: parseFloat(m[1]) });
  }
  return result;
}

function parseHtml(html) {
  const nd   = tryNextData(html);
  const text = stripHtml(html);
  const summary = nd || extractSummary(text);
  if (!summary || summary.pct == null) return null;

  return {
    as_of:         new Date().toISOString().slice(0, 10),
    source:        'Drewry Cancelled Sailings Tracker',
    url:           DREWRY_URL,
    horizon_weeks: extractHorizon(text),
    summary,
    by_trade:    extractByTrade(text),
    by_alliance: extractByAlliance(text),
  };
}

// ── Trend accumulation ────────────────────────────────────────────────────────

function mergeTrend(current, oldCache) {
  const week   = currentIsoWeek();
  const newPt  = { week, pct: current.summary.pct, as_of: current.as_of };
  const old    = Array.isArray(oldCache?.trend) ? oldCache.trend : [];
  const byWeek = {};
  for (const p of [...old, newPt]) {
    if (p.pct != null) byWeek[p.week] = p;
  }
  return Object.values(byWeek)
    .sort((a, b) => a.week - b.week)
    .slice(-8);
}

// ── Renderers ─────────────────────────────────────────────────────────────────

function buildTable(data) {
  const { summary, by_trade, by_alliance, horizon_weeks, as_of, url, trend } = data;

  let wowStr = '—';
  if (Array.isArray(trend) && trend.length >= 2) {
    const diff = trend[trend.length - 1].pct - trend[trend.length - 2].pct;
    const sym  = diff > 0 ? '▲' : diff < 0 ? '▼' : '→';
    wowStr = sym + Math.abs(diff).toFixed(1) + '%p';
  }

  const hw  = horizon_weeks ? '향후 ' + horizon_weeks + '주' : '향후 N주';
  const pct = summary.pct     != null ? '**' + summary.pct.toFixed(1) + '%**' : '—';
  const sch = summary.scheduled != null ? summary.scheduled.toLocaleString('ko-KR') : '—';
  const cnl = summary.cancelled  != null ? summary.cancelled.toLocaleString('ko-KR')  : '—';

  const rows = [
    '| **전체 (' + hw + ')** | **' + sch + '** | **' + cnl + '** | ' + pct + ' | ' + wowStr + ' |',
    ...by_trade.map(t => '| ' + t.trade + ' | — | — | ' + t.pct.toFixed(1) + '% | — |'),
    ...by_alliance.map(a => '| (' + a.name + ' 얼라이언스) | — | — | ' + a.share.toFixed(1) + '% | — |'),
  ];

  if (!rows.length) return null;

  return [
    '| 항로/구분 | 예정 편수 | 결항 편수 | 결항률(%) | 전주 대비 |',
    '|----------|----------|----------|---------|---------|',
    ...rows,
    '',
    '※ ' + as_of + ' 기준. 출처: [Drewry Cancelled Sailings Tracker](' + url + ').',
  ].join('\n');
}

function buildFactText(data) {
  const { summary, by_trade, by_alliance, horizon_weeks, as_of } = data;
  const hw    = horizon_weeks ? '향후 ' + horizon_weeks + '주' : '향후 N주';
  const lines = [];
  if (summary.pct != null) {
    const schPart = summary.scheduled != null ? '/' + summary.scheduled + '편' : '';
    lines.push(
      '전체 결항률: ' + summary.pct.toFixed(1) + '% (결항 ' +
      (summary.cancelled != null ? summary.cancelled : '?') + '편' + schPart + ', ' + hw + ')'
    );
  }
  for (const t of by_trade)    lines.push(t.trade + ': ' + t.pct.toFixed(1) + '%');
  for (const a of by_alliance) lines.push(a.name + ': ' + a.share.toFixed(1) + '%');
  lines.push('(출처: Drewry Cancelled Sailings Tracker, ' + as_of + ')');
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

  console.log('  blank-sailings: Drewry 트래커 수집...');
  const html = await fetchPage();
  if (!html) return null;

  const parsed = parseHtml(html);
  if (!parsed) {
    console.warn('  blank-sailings: 파싱 실패 (JS 렌더링 또는 구조 변경)');
    return null;
  }

  const oldCache  = loadCacheRaw();
  const trend     = mergeTrend(parsed, oldCache);
  const withTrend = { ...parsed, trend };

  const chartData = buildChartData(trend);
  const table     = buildTable(withTrend);
  const factText  = buildFactText(withTrend);

  const payload = { ...withTrend, chartData, table, factText };
  saveCache(payload);
  console.log('  blank-sailings: 완료 (결항률 ' + parsed.summary.pct + '%)');
  return payload;
}

module.exports = { buildBlankSailings, CACHE_PATH };
