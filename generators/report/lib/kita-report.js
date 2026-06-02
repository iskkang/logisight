'use strict';
// KITA 참고운임 → 월간 리포트용 표·factText·차트 데이터 빌더
// 입력: outputs/cache/kita-fare-sea.json, kita-fare-air.json (kita-fare.js가 생성)
// 출력: { table, factText, chartData } — air-indices.js 패턴과 동일
//
// 해운 02절: 부산발 주요 노선 TEU/FEU 표 + 권역 지수(RADIS·북미·유럽·아시아) 추이 차트
// 항공 03-2: 인천발 노선 중량별(100/300/500kg) 표 + 권역 지수 추이 차트

const fs   = require('fs');
const path = require('path');

const SEA_CACHE = path.resolve(__dirname, '../../../outputs/cache/kita-fare-sea.json');
const AIR_CACHE = path.resolve(__dirname, '../../../outputs/cache/kita-fare-air.json');

// 리포트 표에 노출할 부산발 주요 노선 (있는 것만 사용)
const SEA_FEATURED = ['롱비치', '로테르담', '상하이', '싱가포르', '두바이', '보스토치니'];

const COLORS = ['#1E3A5F', '#2E86AB', '#E08E45', '#6A994E', '#BC4749'];

function loadCache(p) {
  try {
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch (_) { return null; }
}

function fmtYm(ym) {
  return ym && ym.length === 6 ? ym.slice(0, 4) + '-' + ym.slice(4) : ym;
}

function fmtDelta(v) {
  if (v == null) return '—';
  if (v > 0) return '▲' + Math.abs(v).toLocaleString();
  if (v < 0) return '▼' + Math.abs(v).toLocaleString();
  return '→';
}

function latestRate(rates) {
  // 가장 마지막 (값 있는) 월
  for (var i = rates.length - 1; i >= 0; i--) {
    if (rates[i].teu != null || rates[i].feu != null || rates[i].kg100 != null) return rates[i];
  }
  return null;
}

// ── 해운 ─────────────────────────────────────────────────────────────────────

function buildKitaSeaReport() {
  const cache = loadCache(SEA_CACHE);
  if (!cache || !cache.routes) return null;

  const ok = cache.routes.filter(function(r) { return !r.error && r.rates && r.rates.length; });
  if (!ok.length) return null;

  // 주요 노선 우선 정렬 (SEA_FEATURED 순서), 그 외는 뒤에
  const featured = [];
  const rest     = [];
  for (var i = 0; i < ok.length; i++) {
    var idx = SEA_FEATURED.indexOf(ok[i].destName);
    if (idx >= 0) featured.push({ idx: idx, route: ok[i] });
    else          rest.push(ok[i]);
  }
  featured.sort(function(a, b) { return a.idx - b.idx; });
  const tableRoutes = featured.map(function(f) { return f.route; }).concat(rest).slice(0, 8);

  // 기준월 = 첫 노선의 최신 월
  const sample = latestRate(tableRoutes[0].rates);
  const asOf   = sample ? fmtYm(sample.yearMon) : '—';

  // ── 표 ──
  const header = '| 노선 (부산 출발) | TEU (USD) | FEU (USD) | TEU MoM | FEU MoM | 기준월 |';
  const sep    = '|------|------|------|------|------|------|';
  const rows = tableRoutes.map(function(r) {
    var l = latestRate(r.rates);
    if (!l) return null;
    return '| ' + r.destName + ' | **' + (l.teu != null ? l.teu.toLocaleString() : '—') + '** | **' +
           (l.feu != null ? l.feu.toLocaleString() : '—') + '** | ' +
           fmtDelta(l.teuChg) + ' | ' + fmtDelta(l.feuChg) + ' | ' + fmtYm(l.yearMon) + ' |';
  }).filter(Boolean);

  const table = '*KITA 해상 참고운임 (부산 출발, USD), 기준 ' + asOf + '*\n\n' +
                [header, sep].concat(rows).join('\n');

  // ── factText (LLM 주입용) ──
  const factLines = ['## KITA 해상 참고운임 (부산 출발, 이 수치만 사용, 다른 운임 수치 생성 금지)'];
  factLines.push('기준월 ' + asOf + ', 단위 USD. TEU=20피트, FEU=40피트 컨테이너 참고운임.');
  tableRoutes.forEach(function(r) {
    var l = latestRate(r.rates);
    if (!l) return;
    var parts = [];
    if (l.teu != null) parts.push('TEU ' + l.teu.toLocaleString() + ' (MoM ' + fmtDelta(l.teuChg) + ')');
    if (l.feu != null) parts.push('FEU ' + l.feu.toLocaleString() + ' (MoM ' + fmtDelta(l.feuChg) + ')');
    factLines.push('부산→' + r.destName + ': ' + parts.join(', '));
  });
  // 권역 지수 (RADIS 종합)
  const idxArr = tableRoutes[0].indices || [];
  if (idxArr.length) {
    var li = idxArr[idxArr.length - 1];
    factLines.push('RADIS 종합지수 ' + (li.radis != null ? li.radis.toLocaleString() : '—') +
      ' (북미 ' + (li.naIndex != null ? li.naIndex.toLocaleString() : '—') +
      ', 유럽 ' + (li.euIndex != null ? li.euIndex.toLocaleString() : '—') +
      ', 아시아 ' + (li.asiaIndex != null ? li.asiaIndex.toLocaleString() : '—') + ')');
  }
  const factText = factLines.join('\n');

  // ── 차트 데이터 (권역 지수 4선) ──
  const chartData = buildSeaIndexChart(tableRoutes[0].indices || []);

  return { table: table, factText: factText, chartData: chartData, asOf: asOf };
}

function buildSeaIndexChart(indices) {
  if (!indices.length) return null;
  const labels = indices.map(function(r) { return fmtYm(r.yearMon); });
  const series = [
    { key: 'radis',     label: 'RADIS 종합' },
    { key: 'naIndex',   label: '북미' },
    { key: 'euIndex',   label: '유럽' },
    { key: 'asiaIndex', label: '아시아' },
  ];
  const datasets = series.map(function(s, i) {
    return {
      label: s.label,
      data: indices.map(function(r) { return r[s.key] != null ? r[s.key] : null; }),
      borderColor: COLORS[i % COLORS.length],
      backgroundColor: 'transparent',
      borderWidth: 2, pointRadius: 0, tension: 0.25, spanGaps: true,
    };
  });
  return { labels: labels, datasets: datasets };
}

// ── 항공 ─────────────────────────────────────────────────────────────────────

function buildKitaAirReport() {
  const cache = loadCache(AIR_CACHE);
  if (!cache || !cache.routes) return null;

  const ok = cache.routes.filter(function(r) { return !r.error && r.rates && r.rates.length; });
  if (!ok.length) return null;

  const tableRoutes = ok.slice(0, 8);
  const sample = latestRate(tableRoutes[0].rates);
  const asOf   = sample ? fmtYm(sample.yearMon) : '—';

  // ── 표 ──
  const header = '| 노선 (인천 출발) | +100kg | +300kg | +500kg | 100kg MoM | 기준월 |';
  const sep    = '|------|------|------|------|------|------|';
  const rows = tableRoutes.map(function(r) {
    var l = latestRate(r.rates);
    if (!l) return null;
    var f = function(v) { return v != null ? '**' + Number(v).toFixed(0) + '**' : '—'; };
    return '| ' + r.destName + ' | ' + f(l.kg100) + ' | ' + f(l.kg300) + ' | ' + f(l.kg500) + ' | ' +
           fmtDelta(l.chg100 != null ? Math.round(l.chg100) : null) + ' | ' + fmtYm(l.yearMon) + ' |';
  }).filter(Boolean);

  const table = '*KITA 항공 참고운임 (인천 출발, USD/건), 기준 ' + asOf + '*\n\n' +
                [header, sep].concat(rows).join('\n');

  // ── factText ──
  const factLines = ['## KITA 항공 참고운임 (인천 출발, 이 수치만 사용, 다른 운임 수치 생성 금지)'];
  factLines.push('기준월 ' + asOf + ', 단위 USD. +100/+300/+500kg 중량 구간별 참고운임.');
  tableRoutes.forEach(function(r) {
    var l = latestRate(r.rates);
    if (!l) return;
    var parts = [];
    if (l.kg100 != null) parts.push('100kg ' + Number(l.kg100).toFixed(0) + ' (MoM ' + fmtDelta(l.chg100 != null ? Math.round(l.chg100) : null) + ')');
    if (l.kg300 != null) parts.push('300kg ' + Number(l.kg300).toFixed(0));
    if (l.kg500 != null) parts.push('500kg ' + Number(l.kg500).toFixed(0));
    factLines.push('인천→' + r.destName + ': ' + parts.join(', '));
  });
  const idxArr = tableRoutes[0].indices || [];
  if (idxArr.length) {
    var li = idxArr[idxArr.length - 1];
    factLines.push('권역 운임지수(KRW): 북미 ' + (li.naIndex != null ? li.naIndex.toLocaleString() : '—') +
      ', 유럽 ' + (li.euIndex != null ? li.euIndex.toLocaleString() : '—') +
      ', 아시아 ' + (li.asiaIndex != null ? li.asiaIndex.toLocaleString() : '—') +
      ', 중국 ' + (li.cnIndex != null ? li.cnIndex.toLocaleString() : '—') + ')');
  }
  const factText = factLines.join('\n');

  // ── 차트 (권역 지수 4선) ──
  const chartData = buildAirIndexChart(tableRoutes[0].indices || []);

  return { table: table, factText: factText, chartData: chartData, asOf: asOf };
}

function buildAirIndexChart(indices) {
  if (!indices.length) return null;
  const labels = indices.map(function(r) { return fmtYm(r.yearMon); });
  const series = [
    { key: 'naIndex',   label: '북미' },
    { key: 'euIndex',   label: '유럽' },
    { key: 'asiaIndex', label: '아시아' },
    { key: 'cnIndex',   label: '중국' },
  ];
  const datasets = series.map(function(s, i) {
    return {
      label: s.label,
      data: indices.map(function(r) { return r[s.key] != null ? r[s.key] : null; }),
      borderColor: COLORS[i % COLORS.length],
      backgroundColor: 'transparent',
      borderWidth: 2, pointRadius: 0, tension: 0.25, spanGaps: true,
    };
  });
  return { labels: labels, datasets: datasets };
}

module.exports = { buildKitaSeaReport, buildKitaAirReport, SEA_CACHE, AIR_CACHE };
