'use strict';
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env.local') });

// Node 20 supabase-js realtime 초기화용 WebSocket 폴리필 (index-factsheet와 동일)
if (typeof globalThis.WebSocket === 'undefined') {
  try { globalThis.WebSocket = require('ws'); } catch (_) {}
}
const { createClient } = require('@supabase/supabase-js');

const QUALITY_KO = { confirmed: '높음', provisional: '중간', indicative: '낮음' };

function isTableQuality(q, sample) {
  return (q === 'confirmed' || q === 'provisional') && Number(sample) >= 3;
}

function getClient() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } });
}

async function loadRailDelay({ weeksBack = 8 } = {}) {
  try {
    const sb = getClient();
    const { data: lanes, error: le } = await sb.from('lanes')
      .select('id,name_ko,transit_min,transit_max,border_points,is_featured,display_order');
    if (le) { console.warn('rail-delay: lanes 실패', le.message); return null; }
    const laneMap = {};
    for (const l of lanes) laneMap[l.id] = l;

    const { data: rows, error: de } = await sb.from('delay_index_weekly')
      .select('lane_id,week_iso,milestone,median_delay_d,p90_delay_d,otp_pct,sample_count,data_quality,route_pattern')
      .eq('milestone', 'DEST_ARR')
      .order('week_iso', { ascending: false });
    if (de) { console.warn('rail-delay: delay 실패', de.message); return null; }
    if (!rows || !rows.length) return { laneMap, rows: [], weeks: [] };

    const weeks = [...new Set(rows.map(r => r.week_iso))].sort().reverse().slice(0, weeksBack);
    const recent = rows.filter(r => weeks.includes(r.week_iso));
    return { laneMap, rows: recent, weeks: weeks.slice().sort() };  // weeks 오름차순
  } catch (e) {
    console.warn('rail-delay: 로드 예외', e.message);
    return null;
  }
}

function buildRailDelayTable(loaded) {
  if (!loaded || !loaded.rows.length) {
    return { table: '> **MTL Link TCR-Tracking 실측 데이터 미수집(금월).**', factText: '' };
  }
  const { laneMap, rows, weeks } = loaded;
  const latestWeek = weeks[weeks.length - 1];

  const byLane = {};
  for (const r of rows) {
    (byLane[r.lane_id] = byLane[r.lane_id] || {})[r.week_iso] = r;
  }

  const laneIds = Object.keys(byLane).sort((a, b) => {
    const la = laneMap[a] || {}, lb = laneMap[b] || {};
    return (lb.is_featured ? 1 : 0) - (la.is_featured ? 1 : 0)
      || (la.display_order || 0) - (lb.display_order || 0)
      || a.localeCompare(b);
  });

  const tableRows = [];
  const factLines = [];
  for (const id of laneIds) {
    const series = byLane[id];
    const wks = Object.keys(series).sort();
    let pick = null;
    for (let i = wks.length - 1; i >= 0; i--) {
      const r = series[wks[i]];
      if (isTableQuality(r.data_quality, r.sample_count)) { pick = r; break; }
    }
    if (!pick) continue;

    const L = laneMap[id] || {};
    const name = L.name_ko || id;
    const std = (L.transit_min && L.transit_max) ? `${L.transit_min}~${L.transit_max}일` : '—';
    const med = Number(pick.median_delay_d);
    const medStr = med <= 0 ? `정시·조기(${med.toFixed(1)}일)` : `+${med.toFixed(1)}일`;
    const p90 = Number(pick.p90_delay_d);
    const p90Str = p90 <= 0 ? '—' : `${p90.toFixed(1)}일`;
    const otp = `${Number(pick.otp_pct).toFixed(0)}%`;
    const border = Array.isArray(L.border_points) ? L.border_points.join('·') : '—';
    const q = `${QUALITY_KO[pick.data_quality] || pick.data_quality}(${pick.sample_count}건)`;
    tableRows.push(`| ${name} | ${std} | ${medStr} | ${p90Str} | ${otp} | ${border} | ${q} |`);

    const trend = wks.map(w => {
      const r = series[w];
      return `${w.replace('2026-', '')} 정시${Number(r.otp_pct).toFixed(0)}%·지연${Number(r.median_delay_d).toFixed(1)}일(표본${r.sample_count}/${r.data_quality})`;
    }).join(' → ');
    factLines.push(`- ${name} [${pick.route_pattern}] 경유 ${border}: ${trend}`);
  }

  if (!tableRows.length) {
    return { table: '> **MTL Link TCR-Tracking 실측 데이터 미수집(신뢰도 충족 행 없음).**', factText: '' };
  }

  const table = [
    `| 회랑 | 표준 운송 | 중앙값 지연 | P90(최악10%) | 정시율 | 경유 국경 | 신뢰도(표본) |`,
    `|------|----------|-----------|-------------|--------|----------|------------|`,
    ...tableRows,
    ``,
    `※ ${latestWeek} 기준, DEST_ARR(최종 도착). 음수=예정 대비 조기 도착. indicative(표본<3) 제외. 출처: MTL Link TCR-Tracking 실측.`,
    ``,
    `[[CHART:rail_otp]]`,
  ].join('\n');

  const factText = [
    `[MTL Link TCR-Tracking 실측 — 회랑별 주간 정시율·지연 추이 (최근 ${weeks.length}주). 이 수치만 사용, 다른 숫자 생성 금지]`,
    ...factLines,
  ].join('\n');

  return { table, factText };
}

module.exports = { loadRailDelay, buildRailDelayTable };
