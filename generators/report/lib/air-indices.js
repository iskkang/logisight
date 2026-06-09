'use strict';
// Air cargo index data for the monthly report air section.
//
// Priority chain:
//   A-2 chart  : Superset BI (TAC Index $/kg time-series)  → null if unavailable (no 1-point fallback)
//   A-1 table  : aircargoweek.com TAC roundup (BAI00 + origin WoW snapshot)
//   A-3 table  : IATA Air Cargo Market Analysis (regional CTK/ACTK/CLF)
//
// Cache: outputs/cache/air-index.json  (TTL 7 days)
// Schema: { fetched_at, source, chartData, baiTable, iataTable, table, factText }

const path = require('path');
const fs   = require('fs');

// Node 20: @supabase/supabase-js Realtime 초기화용 WebSocket shim (③ 제트유 Supabase 조회)
if (typeof globalThis.WebSocket === 'undefined') { try { globalThis.WebSocket = require('ws'); } catch (_) {} }
const { createClient } = require('@supabase/supabase-js');
const { fetchIataFuel } = require('../../web/forecast/inputs/iata-jet-fuel'); // ③
const { buildWorldACD } = require('./worldacd');                             // ②

const { fetchSupersetAirIndex } = require('./superset-fetch');
const { buildIataCargo }        = require('./iata-cargo');
const BI_CHARTS  = require('../config/bi-charts.json');

const CACHE_PATH = path.resolve(__dirname, '../../../outputs/cache/air-index.json');
const CACHE_TTL  = 7 * 24 * 60 * 60 * 1000;   // 7 days in ms
const CACHE_SCHEMA = 2;

// ── Cache I/O ─────────────────────────────────────────────────────────────────

function loadCache() {
  try {
    if (!fs.existsSync(CACHE_PATH)) return null;
    const raw = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf-8'));
    if (raw.schema_version !== CACHE_SCHEMA) return null;
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
      JSON.stringify({ schema_version: CACHE_SCHEMA, fetched_at: new Date().toISOString(), ...payload }, null, 2),
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

// A-3: IATA Air Cargo Market Analysis は iata-cargo.js で処理 (buildIataCargo)

// ── Table builder (Superset TAC — MoM + YoY) ──────────────────────────────────

// TAC Index 항로 한국어 레이블
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
  const asOf   = chartData.labels.at(-1) || month;
  const header = `| 노선 | 최신값 (USD/kg) | MoM | YoY | 기준월 |`;
  const sep    = `|------|---------------|-----|-----|--------|`;

  const rows = chartData.datasets.map(ds => {
    const vals = ds.data;
    let li = vals.length - 1;
    while (li >= 0 && vals[li] == null) li--;
    const latest = li >= 0  ? vals[li]      : null;
    const prevMo = li >= 1  ? vals[li - 1]  : null;
    const prevYr = li >= 12 ? vals[li - 12] : null;
    const lane   = LANE_LABELS[ds.label] || ds.label;
    return `| ${lane} | **${latest != null ? latest.toFixed(2) : '—'}** | ${fmtPct(pctChg(latest, prevMo))} MoM | ${fmtPct(pctChg(latest, prevYr))} YoY | ${asOf} |`;
  });

  return [header, sep, ...rows].join('\n');
}

// ── Fact text for LLM ─────────────────────────────────────────────────────────

function buildFactText({ source, chartData, baiRows, iataTable, month }) {
  const lines = [];

  if (source === 'superset' && chartData) {
    const asOf = chartData.labels.at(-1) || month;
    {
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

  // ── 3. IATA Air Cargo (A-3) — 업로드 파일 우선, fallback: pressroom ──────────
  console.log('  air-indices: IATA 권역별 데이터 수집...');
  const iataBundle = await buildIataCargo({ month });
  const iataTable     = iataBundle?.iataTable     || null;
  const iataFactText2 = iataBundle?.iataFactText  || null;
  if (iataTable) console.log(`  air-indices: IATA OK (asOf=${iataBundle?.data?.asOf})`);
  else           console.warn('  air-indices: IATA 미수집 → A-3 생략');

  // ── 4. IATA Jet Fuel (cost 팩터) — Supabase iata_jet_fuel_weekly (③) ───────
  let jetFuelTable = null;
  try {
    if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
      const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
      const jf = await fetchIataFuel(sb);
      if (jf && jf.price_usd_bbl != null) {
        const wow = jf.fuel_wow_pct != null ? `${jf.fuel_wow_pct > 0 ? '▲' : '▼'}${Math.abs(jf.fuel_wow_pct).toFixed(1)}%` : '—';
        jetFuelTable = [
          '| 항공유 (Jet Fuel) | 가격 | WoW |',
          '|------|------|-----|',
          `| 글로벌 평균 | $${jf.price_usd_bbl.toFixed(2)}/bbl | ${wow} |`,
          '',
          `※ ${jf.as_of} 기준(주간). 출처: [IATA / S&P Global Platts](https://www.iata.org/en/publications/economics/fuel-monitor/). 항공 cost 팩터.`,
        ].join('\n');
        console.log(`  air-indices: 제트유 OK ($${jf.price_usd_bbl}/bbl)`);
      }
    }
  } catch (e) { console.warn('  air-indices: 제트유 수집 실패 —', e.message); }

  // ── 5. WorldACD 주간 구조화 데이터 (②) ─────────────────────────────────────
  let worldacdTable = null;
  try {
    const wacd = await buildWorldACD();
    if (wacd && wacd.table) { worldacdTable = wacd.table; console.log('  air-indices: WorldACD OK'); }
  } catch (e) { console.warn('  air-indices: WorldACD 수집 실패 —', e.message); }

  // ── Abort if nothing at all ───────────────────────────────────────────────
  if (!chartData && !baiTable && !iataTable && !jetFuelTable && !worldacdTable) {
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

  const factText = buildFactText({ source, chartData, baiRows: baiTable, iataTable: iataFactText2 || iataTable, month });

  const asOf = (source === 'superset' && chartData) ? chartData.labels[chartData.labels.length - 1] : null;
  const payload = { source, chartData, baiTable, iataTable, supersetTable, jetFuelTable, worldacdTable, table, factText, ...(asOf ? { asOf } : {}) };
  saveCache(payload);
  console.log(`  air-indices: 완료 (source=${source})`);
  return payload;
}

module.exports = { buildAirIndices, CACHE_PATH };
