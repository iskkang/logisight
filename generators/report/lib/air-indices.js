'use strict';
// Air cargo index data for the monthly report air section.
//
// Priority chain:
//   A-2 chart  : Superset BI (TAC Index $/kg time-series)  → null if unavailable (no 1-point fallback)
//   A-1 table  : aircargoweek.com TAC roundup (BAI00 + origin WoW snapshot)
//   A-3 table  : IATA Air Cargo Market Analysis (regional CTK/ACTK/CLF)
//   A-4 text   : Xeneta public blog/press-release rate data
//
// Cache: outputs/cache/air-index.json  (TTL 7 days)
// Schema: { fetched_at, source, chartData, baiTable, iataTable, xenetaFactText, table, factText }

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
      signal: AbortSignal.timeout(20000),
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

// ── A-1: TAC / BAI snapshot (aircargoweek.com) ────────────────────────────────
// Tries to extract BAI00 + origin-pair indices with WoW comparison.
// Gracefully returns whatever is found; WoW computed if prev-week data available.

async function fetchTacBaiSnapshot() {
  const html = await fetchPage('https://www.aircargoweek.com/market-data/');
  if (!html) return null;

  const text = stripHtml(html);

  // BAI-style patterns: "BAI00 1234", "BAI30 (HKG-EUR) 987", etc.
  const INDEX_PATS = [
    { key: 'BAI00',  label: 'BAI00 (글로벌 평균)',          re: /BAI[- ]?00[^\d]{0,15}([\d,]+)/i  },
    { key: 'BAI30',  label: 'BAI30 (홍콩 → 유럽)',          re: /BAI[- ]?30[^\d]{0,25}([\d,]+)/i  },
    { key: 'BAI80',  label: 'BAI80 (상하이 → 유럽)',         re: /BAI[- ]?80[^\d]{0,25}([\d,]+)/i  },
    { key: 'BAI20',  label: 'BAI20 (프랑크푸르트 → 아시아)', re: /BAI[- ]?20[^\d]{0,25}([\d,]+)/i  },
    { key: 'BAI25',  label: 'BAI25 (프랑크푸르트 → 북미)',   re: /BAI[- ]?25[^\d]{0,25}([\d,]+)/i  },
  ];

  // WoW pattern: "up/down X%" or "▲/▼ X%" near index
  const WOW_RE = /(?:(?:up|down|▲|▼)\s*)([\d.]+)%/gi;

  const rows = [];
  let foundAny = false;

  for (const idx of INDEX_PATS) {
    const m = text.match(idx.re);
    if (!m) continue;
    const val = parseFloat(m[1].replace(/,/g, ''));
    if (isNaN(val) || val < 50) continue;
    foundAny = true;

    // Scan text around this match for WoW percentage
    const pos   = text.indexOf(m[0]);
    const near  = text.slice(Math.max(0, pos - 60), pos + 120);
    const wowMs = [...near.matchAll(WOW_RE)];
    let wow = '';
    if (wowMs.length > 0) {
      const pct = parseFloat(wowMs[0][1]);
      if (!isNaN(pct)) {
        const dir = /down|▼/i.test(wowMs[0][0]) ? '▼' : '▲';
        wow = `${dir}${pct.toFixed(1)}%`;
      }
    }

    rows.push({ key: idx.key, label: idx.label, val: val.toFixed(0), wow });
  }

  if (!foundAny) return null;

  const now  = new Date();
  const week = `${isoYear(now)}-W${String(isoWeek(now)).padStart(2, '0')}`;
  const src  = '[aircargoweek.com](https://www.aircargoweek.com/market-data/)';

  const header = '| 지수 | 최신값 | WoW | 기준주차 | 출처 |';
  const sep    = '|------|--------|-----|---------|------|';
  const lines  = rows.map(r =>
    `| ${r.label} | **${r.val}** | ${r.wow || '—'} | ${week} | ${src} |`
  );
  return [header, sep, ...lines].join('\n');
}

// ── A-3: IATA Air Cargo Regional Data ────────────────────────────────────────
// IATA publishes monthly air cargo market analysis; tries to extract HTML table
// from their public statistics page. Returns null if data is PDF-only.

async function fetchIataRegional() {
  // Try the IATA air freight statistics page (sometimes has embedded data)
  const URLS = [
    'https://www.iata.org/en/publications/economics/air-freight-monthly-analysis/',
    'https://www.iata.org/en/publications/economics/air-freight-statistics/',
  ];

  for (const url of URLS) {
    const html = await fetchPage(url);
    if (!html) continue;

    // Look for a table containing CTK or CLF data
    const tableRe = /<table[\s\S]*?<\/table>/gi;
    const tables  = html.match(tableRe) || [];

    for (const tbl of tables) {
      const tblText = stripHtml(tbl).toLowerCase();
      if (!tblText.includes('ctk') && !tblText.includes('cargo')) continue;

      // Found a likely table — extract rows
      const rowRe = /<tr[\s\S]*?<\/tr>/gi;
      const rows  = tbl.match(rowRe) || [];
      if (rows.length < 3) continue;

      // Build plain-text table from rows
      const mdRows = rows.map(row => {
        const cells = (row.match(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi) || [])
          .map(cell => stripHtml(cell).trim().replace(/\s+/g, ' '));
        return cells.length > 0 ? '| ' + cells.join(' | ') + ' |' : null;
      }).filter(Boolean);

      if (mdRows.length < 3) continue;

      // Add markdown separator after header row
      const colCount = (mdRows[0].match(/\|/g) || []).length - 1;
      const sep = '|' + Array(colCount).fill('---').join('|') + '|';
      return [mdRows[0], sep, ...mdRows.slice(1)].join('\n');
    }

    // If no HTML table found, try to extract text data from JSON-LD or embedded scripts
    const jsonLdRe = /<script type="application\/json">([\s\S]*?)<\/script>/gi;
    let m;
    while ((m = jsonLdRe.exec(html)) !== null) {
      try {
        const data = JSON.parse(m[1]);
        // Superset/BI-style: { data: [{region, ctk_yoy, actk_yoy, clf}, ...] }
        if (Array.isArray(data?.data) && data.data[0]?.ctk_yoy != null) {
          const header = '| 권역 | CTK YoY | ACTK YoY | CLF (%) |';
          const sep    = '|------|---------|---------|---------|';
          const rows = data.data.map(r =>
            `| ${r.region || '—'} | ${r.ctk_yoy ?? '—'} | ${r.actk_yoy ?? '—'} | ${r.clf ?? '—'} |`
          );
          return [header, sep, ...rows].join('\n');
        }
      } catch (_) {}
    }
  }

  return null;
}

// ── A-4: Xeneta public air cargo data ────────────────────────────────────────
// Fetches Xeneta's latest blog/press release and extracts air freight rate numbers
// as fact text for the LLM to reference in analysis.

async function fetchXeneta() {
  const BLOG_URLS = [
    'https://www.xeneta.com/blog/category/air-freight/',
    'https://www.xeneta.com/news/',
    'https://www.xeneta.com/blog/',
  ];

  for (const blogUrl of BLOG_URLS) {
    const html = await fetchPage(blogUrl);
    if (!html) continue;

    // Find article links mentioning air cargo / air freight
    const linkRe = /<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    const airLinks = [];
    let m;
    while ((m = linkRe.exec(html)) !== null) {
      const href  = m[1];
      const label = stripHtml(m[2]).toLowerCase();
      if ((label.includes('air') || label.includes('freight')) && href.includes('xeneta.com')) {
        airLinks.push(href);
      }
    }

    if (!airLinks.length) continue;

    // Fetch the first matching article
    const articleUrl = airLinks[0].startsWith('http') ? airLinks[0] : `https://www.xeneta.com${airLinks[0]}`;
    const articleHtml = await fetchPage(articleUrl);
    if (!articleHtml) continue;

    const articleText = stripHtml(articleHtml);

    // Extract rate mentions: "X USD/kg", "$X/kg", "X% YoY", etc.
    const ratePats = [
      /[\$]?([\d.]+)\s*(?:USD)?\s*\/\s*kg/gi,
      /([\d.]+)\s*USD\s*per\s*kg/gi,
      /(?:up|down|▲|▼|grew?|fell?|declined?|increased?)[^.]{0,60}([\d.]+)\s*%/gi,
    ];

    const snippets = [];
    // Grab sentences containing rate data
    const sentences = articleText.split(/(?<=[.!?])\s+/);
    for (const sent of sentences) {
      for (const pat of ratePats) {
        pat.lastIndex = 0;
        if (pat.test(sent) && sent.length > 20 && sent.length < 300) {
          snippets.push(sent.trim());
          break;
        }
      }
      if (snippets.length >= 6) break;
    }

    if (!snippets.length) continue;

    const today = new Date().toISOString().slice(0, 10);
    return `## Xeneta 공개 운임 데이터 (${today}, ${articleUrl})\n` + snippets.map(s => `- ${s}`).join('\n');
  }

  return null;
}

// ── Table builder (Superset TAC — MoM + YoY) ──────────────────────────────────

const LANE_LABELS = {
  'Frankfurt-N America': '프랑크푸르트→북미',
  'Hong Kong-Europe':    '홍콩→유럽',
  'Hong Kong-N America': '홍콩→북미',
};

function pctChg(cur, prev) {
  return (cur != null && prev != null && prev !== 0) ? ((cur - prev) / prev * 100) : null;
}

function fmtPct(p) {
  if (p == null) return '—';
  const sym = p > 0 ? '▲' : p < 0 ? '▼' : '→';
  return `${sym}${Math.abs(p).toFixed(1)}%`;
}

function buildSupersetTable(chartData, month) {
  const asOf   = chartData.labels[chartData.labels.length - 1] || month;
  const header = `| 노선 | 최신값 (USD/kg) | MoM | YoY | 기준월 |`;
  const sep    = `|------|---------------|-----|-----|--------|`;

  const rows = chartData.datasets.map(ds => {
    const vals = ds.data;
    let li = vals.length - 1;
    while (li >= 0 && vals[li] == null) li--;
    const latest = li >= 0   ? vals[li]      : null;
    const prevMo = li >= 1   ? vals[li - 1]  : null;
    const prevYr = li >= 12  ? vals[li - 12] : null;

    const lane = LANE_LABELS[ds.label] || ds.label;
    const val  = latest != null ? latest.toFixed(2) : '—';
    return `| ${lane} | **${val}** | ${fmtPct(pctChg(latest, prevMo))} MoM | ${fmtPct(pctChg(latest, prevYr))} YoY | ${asOf} |`;
  });

  return [header, sep, ...rows].join('\n');
}

// ── Fact text for LLM ─────────────────────────────────────────────────────────

function buildFactText({ source, chartData, baiRows, iataTable, xenetaFactText, month }) {
  const lines = [];
  const today = new Date().toISOString().slice(0, 10);

  if (source === 'superset' && chartData) {
    const asOf = chartData.labels[chartData.labels.length - 1] || month;
    lines.push(`## TAC Index 항로별 운임 (사내 BI / Superset, USD/kg, 월별, 최신 가용월 ${asOf})`);
    lines.push('※ TAC 월별 데이터는 보고서 발행월 기준 1~2개월 시차 있음. 아래 수치는 실제 수집 기준월.');
    for (const ds of chartData.datasets) {
      const vals = ds.data;
      let li = vals.length - 1;
      while (li >= 0 && vals[li] == null) li--;
      if (li < 0) continue;
      const lane   = LANE_LABELS[ds.label] || ds.label;
      const latest = vals[li];
      const prevMo = li >= 1  ? vals[li - 1]  : null;
      const prevYr = li >= 12 ? vals[li - 12] : null;
      lines.push(`${lane}: ${latest.toFixed(2)} USD/kg (MoM ${fmtPct(pctChg(latest, prevMo))}, YoY ${fmtPct(pctChg(latest, prevYr))})`);
    }
    lines.push('');
  }

  if (baiRows) {
    lines.push('## TAC/BAI 항공 운임 스냅샷 (aircargoweek.com)');
    lines.push(baiRows);
    lines.push('');
  }

  if (iataTable) {
    lines.push('## IATA 권역별 항공화물 수요·공급·적재율');
    lines.push(iataTable);
    lines.push('');
  }

  if (xenetaFactText) {
    lines.push(xenetaFactText);
    lines.push('');
  }

  return lines.join('\n').trim();
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

  // ── 1. Superset chart (A-2) ────────────────────────────────────────────────
  let chartData = null;
  let source    = 'bai-only';

  if (slice_id && dashboard_id) {
    console.log('  air-indices: Superset 수집 시도...');
    chartData = await fetchSupersetAirIndex({ sliceId: slice_id, dashboardId: dashboard_id });
    if (chartData) {
      source = 'superset';
      console.log(`  air-indices: Superset OK (${chartData.labels.length}개 월)`);
    } else {
      console.warn('  air-indices: Superset 실패 → 차트 없음 (1점 fallback 금지)');
    }
  }

  // ── 2. TAC/BAI snapshot table (A-1) ───────────────────────────────────────
  console.log('  air-indices: BAI 스냅샷 수집...');
  const baiTable = await fetchTacBaiSnapshot();
  if (baiTable) console.log('  air-indices: BAI 스냅샷 OK');
  else          console.warn('  air-indices: BAI 스냅샷 미수집');

  // ── 3. IATA regional table (A-3) ──────────────────────────────────────────
  console.log('  air-indices: IATA 권역별 데이터 수집...');
  const iataTable = await fetchIataRegional();
  if (iataTable) console.log('  air-indices: IATA OK');
  else           console.warn('  air-indices: IATA 미수집 (PDF-only 또는 접근 불가)');

  // ── 4. Xeneta data (A-4) ──────────────────────────────────────────────────
  console.log('  air-indices: Xeneta 데이터 수집...');
  const xenetaFactText = await fetchXeneta();
  if (xenetaFactText) console.log('  air-indices: Xeneta OK');
  else                console.warn('  air-indices: Xeneta 미수집');

  // ── Abort if nothing at all ───────────────────────────────────────────────
  if (!chartData && !baiTable && !iataTable && !xenetaFactText) {
    console.warn('  air-indices: 모든 소스 미수집 → null 반환');
    return null;
  }

  // ── Build Superset table (if Superset OK) ─────────────────────────────────
  let supersetTable = null;
  if (source === 'superset' && chartData) {
    supersetTable = buildSupersetTable(chartData, month);
  }

  // combined legacy `table` field = Superset table first, then BAI table
  const table = [supersetTable, baiTable].filter(Boolean).join('\n\n');

  const factText = buildFactText({ source, chartData, baiRows: baiTable, iataTable, xenetaFactText, month });

  const asOf = (source === 'superset' && chartData) ? chartData.labels[chartData.labels.length - 1] : null;
  const payload = { source, chartData, baiTable, iataTable, xenetaFactText, table, factText, ...(asOf ? { asOf } : {}) };
  saveCache(payload);
  console.log(`  air-indices: 완료 (source=${source})`);
  return payload;
}

module.exports = { buildAirIndices, CACHE_PATH };
