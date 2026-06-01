'use strict';
const path = require('path');
const fs   = require('fs');
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env.local') });
if (typeof globalThis.WebSocket === 'undefined') { try { globalThis.WebSocket = require('ws'); } catch (_) {} }
const { createClient } = require('@supabase/supabase-js');

const AIR_CACHE = path.resolve(__dirname, '../../../outputs/cache/air-index.json');
const BS_CACHE  = path.resolve(__dirname, '../../../outputs/cache/blank-sailings.json');
const IA_CACHE  = path.resolve(__dirname, '../../../outputs/cache/intra-asia.json');
const PT_CACHE  = path.resolve(__dirname, '../../../outputs/cache/port-throughput.json');

function sb() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } });
}

const COLORS = [
  '#1E3A5F','#2E86AB','#E08E45','#6A994E','#BC4749','#8E7DBE',
  '#F4A261','#457B9D','#E63946','#2D6A4F','#C9A14A','#8B5E3C','#5C7A99','#9B8B4F',
];

// index_code → 표시 라벨 (차트·표 공용). 표 빌더에서도 재사용하도록 export.
const LABELS = {
  KCCI: '종합', SCFI: '종합', CCFI: '종합', BDI: '종합', WCI: '종합',
  VLSFO: 'VLSFO', HSFO: 'HSFO',
  SCFI_USWC: '미주서안', SCFI_EU: '유럽', SCFI_USEC: '미주동안',
  WCI_SHA_RTM: '상하이-로테르담', WCI_SHA_GOA: '상하이-제노아',
  WCI_SHA_LAX: '상하이-LA', WCI_SHA_NYC: '상하이-뉴욕',
  KCCI_USWC: '미주서안', KCCI_USEC: '미주동안', KCCI_NEU: '북유럽', KCCI_MED: '지중해',
  KCCI_ME: '중동', KCCI_AU: '호주', KCCI_SAE: '남미동안', KCCI_SAW: '남미서안',
  KCCI_ZAF: '남아프리카', KCCI_WAF: '서아프리카', KCCI_CN: '중국', KCCI_JP: '일본', KCCI_SEA: '동남아',
};

// 최신 weeks개만 — ascending 캡 버그 수정: 최신순으로 충분히 받고 라벨 정렬
async function indexSeries(codes, { weeks = 52 } = {}) {
  const { data, error } = await sb().from('freight_indices')
    .select('index_code,week_date,value')
    .in('index_code', codes)
    .order('week_date', { ascending: false })
    .limit(codes.length * (weeks + 8));   // 최신 구간이 모든 코드에 대해 충분히 들어오도록
  if (error || !data || !data.length) return null;

  const byCode = {}; const dateSet = new Set();
  for (const r of data) {
    if (r.value == null) continue;
    (byCode[r.index_code] = byCode[r.index_code] || {})[r.week_date] = Number(r.value);
    dateSet.add(r.week_date);
  }
  let labels = [...dateSet].sort();           // 오름차순(시간순)
  if (labels.length > weeks) labels = labels.slice(-weeks);

  const datasets = codes.filter(c => byCode[c]).map((c, i) => ({
    label: LABELS[c] || c,
    data: labels.map(d => (byCode[c][d] ?? null)),
    borderColor: COLORS[i % COLORS.length],
    backgroundColor: 'transparent',
    borderWidth: 2, pointRadius: 0, tension: 0.25, spanGaps: true,
  }));
  if (!datasets.length) return null;
  return { labels, datasets };
}

// 지수별 추이 차트 — KCCI 전 항로, SCFI 4계열, 나머지 종합선 위주
const getOceanKcci   = () => indexSeries(
  ['KCCI','KCCI_USWC','KCCI_USEC','KCCI_NEU','KCCI_MED','KCCI_ME','KCCI_AU','KCCI_SAE','KCCI_SAW','KCCI_ZAF','KCCI_WAF','KCCI_CN','KCCI_JP','KCCI_SEA'],
  { weeks: 26 },
);
const getOceanScfi   = () => indexSeries(['SCFI','SCFI_USWC','SCFI_EU','SCFI_USEC']);
const getOceanCcfi   = () => indexSeries(['CCFI']);
const getOceanBdi    = () => indexSeries(['BDI']);
const getOceanBunker = () => indexSeries(['VLSFO', 'HSFO']);
// WCI는 항로(월별 4개)까지 — 데이터가 적어 다중선이 보기 좋음
const getOceanWci    = () => indexSeries(['WCI', 'WCI_SHA_RTM', 'WCI_SHA_GOA', 'WCI_SHA_LAX', 'WCI_SHA_NYC']);

// Air rate: reads from outputs/cache/air-index.json written by air-indices.js
// Cache schema: { fetched_at, source, chartData: { labels, datasets }, table, factText }
async function getAirRate() {
  try {
    if (!fs.existsSync(AIR_CACHE)) return null;
    const raw = JSON.parse(fs.readFileSync(AIR_CACHE, 'utf-8'));
    const cd  = raw.chartData || raw;  // handle both nested and legacy flat schema
    if (!cd.labels || !cd.datasets?.length) return null;
    return cd;
  } catch (_) { return null; }
}

async function getOceanBlankSailings() {
  try {
    if (!fs.existsSync(BS_CACHE)) return null;
    const raw = JSON.parse(fs.readFileSync(BS_CACHE, 'utf-8'));
    const cd  = raw.chartData;
    if (!cd?.labels || !cd.datasets?.length) return null;
    return cd;
  } catch (_) { return null; }
}

async function getOceanIntraAsia() {
  try {
    if (!fs.existsSync(IA_CACHE)) return null;
    const raw = JSON.parse(fs.readFileSync(IA_CACHE, 'utf-8'));
    const cd  = raw.chartData;
    if (!cd?.labels || !cd.datasets?.length) return null;
    return cd;
  } catch (_) { return null; }
}

async function getMacroPortThroughput() {
  try {
    if (!fs.existsSync(PT_CACHE)) return null;
    const raw = JSON.parse(fs.readFileSync(PT_CACHE, 'utf-8'));
    const cd  = raw.chartData;
    if (!cd?.labels || !cd.datasets?.length) return null;
    return cd;
  } catch (_) { return null; }
}

async function getRailOtp() {
  const client = sb();
  const { data, error } = await client.from('delay_index_weekly')
    .select('lane_id,week_iso,otp_pct,milestone,data_quality,sample_count')
    .eq('milestone', 'DEST_ARR')
    .order('week_iso', { ascending: true });
  if (error || !data || !data.length) return null;

  const { data: lanes } = await client.from('lanes').select('id,name_ko');
  const nameMap = {}; (lanes || []).forEach(l => { nameMap[l.id] = l.name_ko || l.id; });

  const byLane = {}; const weekSet = new Set();
  for (const r of data) {
    if (!((r.data_quality === 'confirmed' || r.data_quality === 'provisional') && r.sample_count >= 3)) continue;
    (byLane[r.lane_id] = byLane[r.lane_id] || {})[r.week_iso] = Number(r.otp_pct);
    weekSet.add(r.week_iso);
  }
  const labels = [...weekSet].sort();
  const laneIds = Object.keys(byLane);
  if (!laneIds.length) return null;

  const datasets = laneIds.map((id, i) => ({
    label: nameMap[id] || id,
    data: labels.map(w => (byLane[id][w] ?? null)),
    borderColor: COLORS[i % COLORS.length],
    backgroundColor: 'transparent',
    borderWidth: 2, pointRadius: 2, tension: 0.2, spanGaps: true,
  }));
  return { labels, datasets };
}

const CHARTS = {
  ocean_kcci:   { title: 'KCCI(한국형 컨테이너 운임지수) 추이', loader: getOceanKcci,   yLabel: 'index' },
  ocean_scfi:   { title: 'SCFI(상하이 컨테이너운임지수) 추이',  loader: getOceanScfi,   yLabel: 'index' },
  ocean_ccfi:   { title: 'CCFI(중국 컨테이너운임지수) 추이',    loader: getOceanCcfi,   yLabel: 'index' },
  ocean_bdi:    { title: 'BDI(건화물선운임지수) 추이',          loader: getOceanBdi,    yLabel: 'index' },
  ocean_wci:    { title: 'WCI(드류리) 종합·항로별 추이',        loader: getOceanWci,    yLabel: 'USD/FEU' },
  ocean_bunker:          { title: '벙커유(VLSFO·HSFO) 추이',                           loader: getOceanBunker,         yLabel: 'USD/ton' },
  ocean_blank_sailings:  { title: '블랭크 세일링 결항률 추이 (Drewry)',                    loader: getOceanBlankSailings,  yLabel: '%' },
  ocean_intra_asia:      { title: '역내(Intra-Asia) 운임 추이 (KCCI 역내 항로 proxy)',    loader: getOceanIntraAsia,      yLabel: 'index' },
  macro_port_throughput: { title: '글로벌 컨테이너 항만 처리량 지수 추이 (ISL/RWI-ISL)', loader: getMacroPortThroughput, yLabel: 'index' },
  rail_otp:     { title: '유라시아 회랑별 정시율 (MTL Link 실측)', loader: getRailOtp,   yLabel: 'OTP %' },
  air_rate:     { title: '항공 화물 스팟 운임 추이 (WorldACD 글로벌 평균)', loader: getAirRate, yLabel: 'USD/kg' },
};

async function buildChart(id) {
  const def = CHARTS[id];
  if (!def) return null;
  try {
    const data = await def.loader();
    if (!data) return null;
    return { id, title: def.title, yLabel: def.yLabel, data };
  } catch (e) { console.warn(`chart-data: ${id} 로드 실패`, e.message); return null; }
}

module.exports = { CHARTS, LABELS, buildChart };
