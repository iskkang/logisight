'use strict';
// Blank sailing data for the monthly report.
// Source: Drewry Cancelled Sailings Tracker public headline.
// Cache: outputs/cache/blank-sailings.json (TTL 7 days)

const path = require('path');
const fs   = require('fs');
const { buildDrewryHeadline } = require('./drewry-headline');

const CACHE_PATH   = path.resolve(__dirname, '../../../outputs/cache/blank-sailings.json');
const CACHE_TTL    = 7 * 24 * 60 * 60 * 1000;
const CACHE_SCHEMA = 4;

function isFresh(raw) {
  return raw?.fetched_at && Date.now() - new Date(raw.fetched_at).getTime() <= CACHE_TTL;
}

function loadCache() {
  try {
    if (!fs.existsSync(CACHE_PATH)) return null;
    const raw = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf-8'));
    if (raw.schema_version !== CACHE_SCHEMA || !isFresh(raw)) return null;
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
  } catch (e) {
    console.warn('  blank-sailings: 캐시 저장 실패:', e.message);
  }
}

function publishedAt(drewry) {
  const m = String(drewry.sentence || '').match(/^([0-9]{1,2}\s+[A-Za-z]+\s+[0-9]{4}):/);
  return m ? m[1] : drewry.asOf;
}

function forecastWindow(drewry) {
  const m = String(drewry.sentence || '').match(
    /from\s+(week\s+[0-9]+\s+\([^)]+\))\s+to\s+(week\s+[0-9]+\s+\([^)]+\))/i,
  );
  return m ? `${m[1]} to ${m[2]}` : `향후 ${drewry.horizon || 'N'}주`;
}

function buildTable(data) {
  const { summary, as_of, forecast_window, url } = data;
  return [
    '| 발표 기준 | 전망 구간 | 예정 출항 | 예정 결항 | 결항률 | 정상 운항 예정 |',
    '|----------|----------|----------|----------|--------|--------------|',
    `| **${as_of}** | ${forecast_window} | **${summary.scheduled.toLocaleString('ko-KR')}편** | **${summary.cancelled.toLocaleString('ko-KR')}편** | **${summary.pct.toFixed(1)}%** | ${summary.expected_to_sail.toLocaleString('ko-KR')}편 (${summary.expected_to_sail_pct.toFixed(1)}%) |`,
    '',
    `※ 출처: [Drewry Cancelled Sailings Tracker](${url}). Drewry 공개 tracker의 동서 주요 항로 예정 출항 기준.`,
  ].join('\n');
}

function buildFactText(data) {
  const { summary, as_of, forecast_window } = data;
  return [
    `[Drewry Cancelled Sailings Tracker] ${as_of} 발표 기준 ${forecast_window},`,
    `동서 주요 항로 예정 출항 ${summary.scheduled}편 중 ${summary.cancelled}편 결항 예정 (${summary.pct.toFixed(1)}%).`,
    `정상 운항 예정 ${summary.expected_to_sail}편 (${summary.expected_to_sail_pct.toFixed(1)}%).`,
  ].join(' ');
}

function buildPayload(drewry) {
  const scheduled      = Number(drewry.scheduled);
  const cancelled      = Number(drewry.blank);
  const expectedToSail = scheduled - cancelled;
  const pct            = drewry.pct != null ? Number(drewry.pct) : (cancelled / scheduled) * 100;
  const expectedPct    = scheduled > 0 ? (expectedToSail / scheduled) * 100 : null;

  const payload = {
    as_of:           publishedAt(drewry),
    source:          drewry.source,
    url:             drewry.url,
    horizon_weeks:   drewry.horizon,
    forecast_window: forecastWindow(drewry),
    summary: {
      scheduled,
      cancelled,
      pct,
      expected_to_sail:     expectedToSail,
      expected_to_sail_pct: expectedPct,
    },
  };
  payload.table    = buildTable(payload);
  payload.factText = buildFactText(payload);
  return payload;
}

async function buildBlankSailings({ force = false } = {}) {
  if (!force) {
    const cached = loadCache();
    if (cached) {
      console.log('  blank-sailings: Drewry 캐시 사용 (' + cached.as_of + ')');
      return cached;
    }
  }

  console.log('  blank-sailings: Drewry 공개 tracker 수집 중...');
  const drewry = await buildDrewryHeadline();
  if (!drewry) {
    console.warn('  blank-sailings: Drewry 공개 헤드라인 미수집');
    return null;
  }
  if (!(Number(drewry.scheduled) > 0)) {
    console.warn('  blank-sailings: scheduled departures 미표기 — 정량 블록 생략');
    return null;
  }

  const payload = buildPayload(drewry);
  saveCache(payload);
  console.log('  blank-sailings: 완료 (' + payload.summary.cancelled + '편/' + payload.summary.scheduled + '편)');
  return payload;
}

module.exports = { buildBlankSailings, CACHE_PATH };
