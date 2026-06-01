'use strict';
// IATA Air Cargo Market Analysis → 권역별 CTK/ACTK/CLF 구조화
//
// 우선순위:
//   1. generators/report/inputs/iata/air-cargo-YYYY-MM.(pdf|txt|html)
//   2. fallback: IATA pressroom 자동 fetch
//   모두 실패 → null (A-3 생략)
//
// 주의: 여객(RPK/ASK) 파일이 들어오면 거부.

const fs   = require('fs');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env.local') });

const { callDeepSeek } = require('../../lib/deepseek');

const INPUT_DIR  = path.resolve(__dirname, '../inputs/iata');
const CACHE_PATH = path.resolve(__dirname, '../../../outputs/cache/iata-cargo.json');
const CACHE_TTL  = 7 * 24 * 60 * 60 * 1000;  // 7 days

const PASSENGER_RE = /\b(?:air passenger|RPK|ASK|passenger km|pax traffic|available seat)\b/i;
const CARGO_RE     = /\b(?:air cargo|CTK|ACTK|cargo tonne|freight tonne|CLF|cargo load factor)\b/i;

// ── File discovery ────────────────────────────────────────────────────────────

function findInputFile(month) {
  if (!fs.existsSync(INPUT_DIR)) return null;
  const files = fs.readdirSync(INPUT_DIR)
    .filter(f => /^air-cargo-\d{4}-\d{2}\.(pdf|txt|html)$/.test(f))
    .sort()
    .reverse();
  if (!files.length) return null;
  if (month) {
    const hit = files.find(f => f.includes(month));
    if (hit) return path.join(INPUT_DIR, hit);
  }
  return path.join(INPUT_DIR, files[0]);
}

// ── Text extraction ───────────────────────────────────────────────────────────

async function extractText(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const buf = fs.readFileSync(filePath);

  if (ext === '.pdf') {
    const pdfParse = require('pdf-parse');
    const result   = await pdfParse(buf);
    return result.text;
  }

  let text = buf.toString('utf-8');
  if (ext === '.html') {
    text = text
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/\s+/g, ' ');
  }
  return text;
}

// ── Fallback: IATA pressroom ──────────────────────────────────────────────────

async function fetchIataPressroom() {
  const PRESS_URLS = [
    'https://www.iata.org/en/pressroom/pressroom-archive/2026-news/2026-04-air-cargo-demand/',
    'https://www.iata.org/en/pressroom/pressroom-archive/2026-news/2026-03-air-cargo-demand/',
    'https://www.iata.org/en/pressroom/pressroom-archive/2026-news/2026-02-air-cargo-demand/',
    'https://www.iata.org/en/pressroom/2026-news-releases/',
  ];
  for (const url of PRESS_URLS) {
    try {
      const r = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LogisightBot/1.0)' },
        signal: AbortSignal.timeout(20000),
      });
      if (!r.ok) continue;
      const html = await r.text();
      if (!CARGO_RE.test(html)) continue;
      const text = html
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/\s+/g, ' ')
        .slice(0, 8000);
      console.log(`  iata-cargo: pressroom ${url.slice(-40)} 성공`);
      return text;
    } catch (_) {}
  }
  return null;
}

// ── LLM structuring ───────────────────────────────────────────────────────────

const SCHEMA_EXAMPLE = {
  asOf: '2026-04',
  headline: { ctk_yoy: 4.0, actk_yoy: -0.4, clf_level: null, clf_ppt: null },
  regions: [
    { region: '전체(글로벌)',  share: null, ctk_yoy: 4.0,  actk_yoy: -0.4, clf_level: null, clf_ppt: null },
    { region: '아시아태평양', share: 35.8, ctk_yoy: 10.5, actk_yoy: 5.3,  clf_level: null, clf_ppt: null },
    { region: '유럽',         share: 21.4, ctk_yoy: 6.0,  actk_yoy: null, clf_level: null, clf_ppt: null },
    { region: '북미',         share: 24.6, ctk_yoy: 5.0,  actk_yoy: 1.2,  clf_level: null, clf_ppt: null },
    { region: '중동',         share: 13.2, ctk_yoy: null, actk_yoy: null, clf_level: null, clf_ppt: null },
    { region: '남미·카리브',  share: 2.9,  ctk_yoy: null, actk_yoy: null, clf_level: null, clf_ppt: null },
    { region: '아프리카',     share: 2.1,  ctk_yoy: null, actk_yoy: null, clf_level: null, clf_ppt: null },
  ],
};

async function structureWithLlm(text, month) {
  const sys =
    '아래 IATA Air Cargo 자료에서 권역별 시장점유율·CTK YoY·ACTK YoY·CLF(수준·ppt)와 전체 수치를 추출해 ' +
    '다음 스키마 JSON으로만 출력. 설명·코드펜스 없이 JSON만. 자료에 없는 값은 null. 수치 날조 금지.\n\n' +
    '스키마:\n' + JSON.stringify(SCHEMA_EXAMPLE, null, 2);

  const resp = await callDeepSeek({
    max_tokens: 1200,
    system: sys,
    messages: [{ role: 'user', content: `분석 기준월: ${month}\n\n${text.slice(0, 6000)}` }],
  });

  const raw = resp.content[0].text.replace(/```json|```/g, '').trim();
  return JSON.parse(raw);
}

// ── Render helpers ────────────────────────────────────────────────────────────

function fmtPct(v, suffix = '%') {
  if (v == null) return '—';
  const sym = v > 0 ? '▲' : v < 0 ? '▼' : '→';
  return `${sym}${Math.abs(v).toFixed(1)}${suffix}`;
}
function fmtVal(v, suffix = '') {
  return v != null ? `${v}${suffix}` : '—';
}

function buildIataTable(data) {
  if (!data?.regions?.length) return null;

  const asOf   = data.asOf || '—';
  const header = '| 권역 | 점유율 | CTK YoY | ACTK YoY | CLF (수준) | CLF (ppt) |';
  const sep    = '|------|--------|---------|---------|-----------|-----------|';

  // 전체(글로벌) 행 우선 — headline 또는 regions의 전체 행
  const globalRow = data.headline
    ? { region: '전체(글로벌)', share: null, ...data.headline }
    : data.regions.find(r => r.region === '전체(글로벌)');

  const rest = data.regions.filter(r => r.region !== '전체(글로벌)');
  const allRows = globalRow ? [globalRow, ...rest] : rest;

  const rows = allRows.map(r =>
    `| ${r.region} | ${fmtVal(r.share, '%')} | ${fmtPct(r.ctk_yoy)} | ${fmtPct(r.actk_yoy)} | ${fmtVal(r.clf_level, '%')} | ${fmtPct(r.clf_ppt, 'pp')} |`
  );

  return `*IATA Air Cargo Market Analysis, 기준 ${asOf}*\n\n` + [header, sep, ...rows].join('\n');
}

function buildIataFactText(data) {
  if (!data?.regions?.length) return null;

  const asOf  = data.asOf || '—';
  const lines = [`## IATA 권역별 항공화물 수요·공급·적재율 (기준 ${asOf})`];

  if (data.headline) {
    const h = data.headline;
    const parts = [];
    if (h.ctk_yoy  != null) parts.push(`CTK ${h.ctk_yoy}% YoY`);
    if (h.actk_yoy != null) parts.push(`ACTK ${h.actk_yoy}% YoY`);
    if (h.clf_level != null) parts.push(`CLF ${h.clf_level}%`);
    if (h.clf_ppt   != null) parts.push(`(${h.clf_ppt > 0 ? '+' : ''}${h.clf_ppt}pp)`);
    if (parts.length) lines.push(`전체: ${parts.join(', ')}`);
  }

  for (const r of data.regions) {
    if (r.region === '전체(글로벌)') continue;
    const parts = [];
    if (r.share    != null) parts.push(`점유율 ${r.share}%`);
    if (r.ctk_yoy  != null) parts.push(`CTK ${r.ctk_yoy}% YoY`);
    if (r.actk_yoy != null) parts.push(`ACTK ${r.actk_yoy}% YoY`);
    if (r.clf_level != null) parts.push(`CLF ${r.clf_level}%`);
    if (r.clf_ppt   != null) parts.push(`(${r.clf_ppt > 0 ? '+' : ''}${r.clf_ppt}pp)`);
    if (parts.length) lines.push(`${r.region}: ${parts.join(', ')}`);
  }

  return lines.join('\n');
}

// ── Cache ─────────────────────────────────────────────────────────────────────

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
    fs.writeFileSync(CACHE_PATH, JSON.stringify({ fetched_at: new Date().toISOString(), ...payload }, null, 2), 'utf-8');
  } catch (e) { console.warn('  iata-cargo: 캐시 저장 실패:', e.message); }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function buildIataCargo({ month, force = false } = {}) {
  if (!force) {
    const cached = loadCache();
    if (cached) {
      console.log(`  iata-cargo: 캐시 사용 (asOf=${cached.data?.asOf}, ${cached.fetched_at.slice(0, 10)})`);
      return cached;
    }
  }

  // 1. Input file
  let text   = null;
  let source = null;
  const filePath = findInputFile(month);

  if (filePath) {
    console.log(`  iata-cargo: 파일 발견 → ${path.basename(filePath)}`);
    try {
      text = await extractText(filePath);
      if (PASSENGER_RE.test(text) && !CARGO_RE.test(text)) {
        console.warn('  iata-cargo: ⚠️ 여객 자료 감지(RPK/ASK) — Air Cargo 자료 필요. 건너뜀.');
        text = null;
      } else {
        source = path.basename(filePath);
        console.log(`  iata-cargo: 텍스트 추출 완료 (${text.length}자)`);
      }
    } catch (e) {
      console.warn(`  iata-cargo: 파일 읽기 실패: ${e.message}`);
    }
  }

  // 2. Fallback: pressroom fetch
  if (!text) {
    console.log('  iata-cargo: 파일 없음 → pressroom fallback...');
    text = await fetchIataPressroom();
    if (text) source = 'iata-pressroom';
  }

  if (!text) {
    console.warn('  iata-cargo: 모든 소스 실패 → A-3 생략');
    return null;
  }

  // 3. LLM structuring
  console.log('  iata-cargo: LLM 구조화 중...');
  let data;
  try {
    data = await structureWithLlm(text, month || new Date().toISOString().slice(0, 7));
    if (!data?.regions?.length) throw new Error('regions 배열 없음');
    console.log(`  iata-cargo: 완료 (asOf=${data.asOf}, ${data.regions.length}개 권역)`);
  } catch (e) {
    console.warn(`  iata-cargo: LLM 구조화 실패: ${e.message}`);
    return null;
  }

  // 4. Render
  const iataTable    = buildIataTable(data);
  const iataFactText = buildIataFactText(data);

  const payload = { source, data, iataTable, iataFactText };
  saveCache(payload);
  return payload;
}

module.exports = { buildIataCargo, CACHE_PATH };
