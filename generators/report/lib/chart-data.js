'use strict';
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env.local') });
if (typeof globalThis.WebSocket === 'undefined') { try { globalThis.WebSocket = require('ws'); } catch (_) {} }
const { createClient } = require('@supabase/supabase-js');

function sb() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } });
}

// 리포트 톤(네이비·시안 계열) 팔레트
const COLORS = ['#1E3A5F', '#2E86AB', '#E08E45', '#6A994E', '#BC4749', '#8E7DBE'];

async function indexSeries(codes, { weeks = 52 } = {}) {
  const { data, error } = await sb().from('freight_indices')
    .select('index_code,week_date,value')
    .in('index_code', codes)
    .order('week_date', { ascending: true });
  if (error || !data || !data.length) return null;

  const byCode = {}; const dateSet = new Set();
  for (const r of data) {
    if (r.value == null) continue;
    (byCode[r.index_code] = byCode[r.index_code] || {})[r.week_date] = Number(r.value);
    dateSet.add(r.week_date);
  }
  let labels = [...dateSet].sort();
  if (labels.length > weeks) labels = labels.slice(-weeks);

  const datasets = codes.filter(c => byCode[c]).map((c, i) => ({
    label: c,
    data: labels.map(d => (byCode[c][d] ?? null)),
    borderColor: COLORS[i % COLORS.length],
    backgroundColor: 'transparent',
    borderWidth: 2, pointRadius: 0, tension: 0.25, spanGaps: true,
  }));
  if (!datasets.length) return null;
  return { labels, datasets };
}

const getOceanScfi   = () => indexSeries(['SCFI', 'SCFI_USWC', 'SCFI_EU', 'SCFI_USEC']);
const getOceanBdi    = () => indexSeries(['BDI']);
const getOceanBunker = () => indexSeries(['VLSFO', 'HSFO']);

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
  ocean_scfi:   { title: 'SCFI 종합·항로별 추이',               loader: getOceanScfi,   yLabel: 'index' },
  ocean_bdi:    { title: 'BDI(건화물) 추이',                     loader: getOceanBdi,    yLabel: 'index' },
  ocean_bunker: { title: '벙커유(VLSFO·HSFO) 추이',              loader: getOceanBunker, yLabel: 'USD/ton' },
  rail_otp:     { title: '유라시아 회랑별 정시율 (MTL Link 실측)', loader: getRailOtp,     yLabel: 'OTP %' },
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

module.exports = { CHARTS, buildChart };
