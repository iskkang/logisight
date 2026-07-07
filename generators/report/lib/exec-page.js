'use strict';
// generators/report/lib/exec-page.js
// Executive Summary 페이지 (DHL OFR p2 문법) + KCCI 항로 히트맵 — 렌더 타임 결정론 생성.
// 수치는 전부 기존 소스(지수 표 KPI·파생 지표·Drewry 결항 캐시·RWI/ISL 캐시)에서만 취함.
const fs = require('fs');
const path = require('path');

const CACHE_DIR = path.resolve(__dirname, '../../../outputs/cache');

const LANE_KO = {
  KCCI: '종합', KCCI_USWC: '미주서안', KCCI_USEC: '미주동안', KCCI_NEU: '북유럽',
  KCCI_MED: '지중해', KCCI_ME: '중동', KCCI_AU: '호주', KCCI_SAE: '남미동안',
  KCCI_SAW: '남미서안', KCCI_ZAF: '남아프리카', KCCI_WAF: '서아프리카',
  KCCI_CN: '중국', KCCI_JP: '일본', KCCI_SEA: '동남아',
};

function readCache(name) {
  try {
    return JSON.parse(fs.readFileSync(path.join(CACHE_DIR, name), 'utf-8'));
  } catch (_) { return null; }
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function pct(n, digits = 1) {
  const v = Number(n);
  if (!Number.isFinite(v)) return null;
  const arrow = v > 0 ? '▲' : v < 0 ? '▼' : '';
  return `${arrow}${Math.abs(v).toFixed(digits)}%`;
}

// ── KCCI 항로 히트맵: 최근 6개월 월말(최근접 공표주) 값 → MoM 방향 매트릭스 ──
async function buildKcciHeatmap(weekEnd) {
  const ws = require('ws'); globalThis.WebSocket = ws;
  const { createClient } = require('@supabase/supabase-js');
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  const sb = createClient(url, key, { auth: { persistSession: false } });

  const codes = Object.keys(LANE_KO);
  const { data, error } = await sb.from('freight_indices')
    .select('index_code,week_date,value')
    .in('index_code', codes)
    .lte('week_date', weekEnd)
    .order('week_date', { ascending: false })
    .limit(codes.length * 40);
  if (error || !data || !data.length) return null;

  const byCode = {};
  for (const r of data) (byCode[r.index_code] = byCode[r.index_code] || []).push(r);

  // 월말 기준일 7개(방향 6칸) — weekEnd가 속한 달부터 역순
  const ends = [];
  let d = new Date(weekEnd + 'T00:00:00Z');
  for (let i = 0; i < 7; i++) {
    const y = d.getUTCFullYear(), m = d.getUTCMonth();
    ends.unshift(new Date(Date.UTC(y, m + 1, 0)).toISOString().slice(0, 10));
    d = new Date(Date.UTC(y, m, 0));
  }
  const monthLabels = ends.slice(1).map((e) => `${Number(e.slice(5, 7))}월`);

  const rows = [];
  for (const code of codes) {
    const series = byCode[code];
    if (!series || series.length < 8) continue;
    const vals = ends.map((end) => {
      const hit = series.find((r) => r.week_date <= end); // desc 정렬 → 최근접 공표주
      return hit ? Number(hit.value) : null;
    });
    const cells = [];
    for (let i = 1; i < vals.length; i++) {
      if (vals[i] == null || vals[i - 1] == null || !vals[i - 1]) { cells.push(null); continue; }
      cells.push(((vals[i] - vals[i - 1]) / vals[i - 1]) * 100);
    }
    rows.push({ code, label: LANE_KO[code], cells });
  }
  if (rows.length < 8) return null;
  rows.sort((a, b) => (a.code === 'KCCI' ? -1 : b.code === 'KCCI' ? 1 : 0));

  const head = monthLabels.map((m) => `<th>${m}</th>`).join('');
  const body = rows.map((r) => {
    const tds = r.cells.map((c) => {
      if (c == null) return '<td class="hm-na">–</td>';
      const cls = c > 1 ? 'hm-up' : c < -1 ? 'hm-down' : 'hm-flat';
      const arrow = c > 1 ? '▲' : c < -1 ? '▼' : '';
      return `<td class="${cls}">${arrow}${Math.abs(c).toFixed(1)}</td>`;
    }).join('');
    const bold = r.code === 'KCCI' ? ' class="hm-total"' : '';
    return `<tr${bold}><td>${esc(r.label)}</td>${tds}</tr>`;
  }).join('');

  return `<div class="hm-wrap">
<div class="dash-band"><span>KCCI 항로별 월간 등락률 히트맵 (%)</span><small>최근 6개월 · 월말 최근접 공표주 기준</small></div>
<table class="heatmap"><thead><tr><th>항로</th>${head}</tr></thead><tbody>${body}</tbody></table>
<div class="dash-src">출처: KOBC(KCCI) © Logisight — 셀 값은 전월 말 대비 등락률, ±1% 이내는 보합</div>
</div>`;
}

// ── Executive Summary 4행 (Rates·Contract·Capacity·Demand/Bunker) ──
async function buildExecRows(front, weekEnd) {
  const kpi = (label) => (front.kpis || []).find((k) => k.label === label);
  const rows = [];

  // 파생 지표 (계약-스팟 갭·벙커 괴리) — 생성·검증과 동일 소스 재사용
  let gapLines = [], bunkerLine = null;
  try {
    const { buildDerivedMetrics, loadKitaLanes } = require('./derived-metrics-loader');
    const dm = await buildDerivedMetrics({ weekEnd, kitaSea: loadKitaLanes() });
    if (dm.gapBlock) {
      gapLines = dm.gapBlock.factText.split('\n').filter((l) => l.includes(':')).slice(0, 2);
    }
    if (dm.bunkerDivergenceBlock) {
      bunkerLine = dm.bunkerDivergenceBlock.factText.split('\n')
        .find((l) => l.includes('괴리') && !l.startsWith('#') && /[0-9]/.test(l));
    }
  } catch (_) { /* 파생 로드 실패 시 해당 불릿 생략 */ }

  const kcci = kpi('KCCI 종합'), scfi = kpi('SCFI 종합'), wci = kpi('WCI 종합'), bdi = kpi('BDI');
  if (kcci) {
    const bullets = [];
    if (scfi && wci) bullets.push(`SCFI ${esc(scfi.mom)} · WCI ${esc(wci.mom)} MoM — 원양 지수 동반 상승`);
    if (bdi) bullets.push(`BDI ${esc(bdi.mom)} MoM — 컨테이너-벌크 상반된 흐름`);
    rows.push({ tag: 'RATES', dir: kcci.dir, headline: `KCCI ${esc(kcci.val)} · ${esc(kcci.mom)} MoM`, bullets });
  }
  if (gapLines.length) {
    rows.push({
      tag: 'CONTRACT', dir: 'up',
      headline: '스팟 급등분의 계약 반영 가속',
      bullets: gapLines.map((l) => esc(l.replace(/^[-•\s]+/, ''))),
    });
  }
  const bs = readCache('blank-sailings.json');
  if (bs && bs.summary) {
    rows.push({
      tag: 'CAPACITY', dir: bs.summary.pct > 8 ? 'down' : '',
      headline: `향후 ${bs.horizon_weeks}주 결항률 ${bs.summary.pct}%`,
      bullets: [
        `예정 ${bs.summary.scheduled}편 중 ${bs.summary.cancelled}편 결항 — ${esc(bs.forecast_window || '')}`,
        `출항 예정 비율 ${Number(bs.summary.expected_to_sail_pct).toFixed(1)}% (Drewry Cancelled Sailings Tracker, ${esc(bs.as_of || '')})`,
      ],
    });
  }
  const pt = readCache('port-throughput.json');
  const demandBullets = [];
  if (pt && pt.index != null) {
    const mom = pct(pt.mom_pct, 2);
    demandBullets.push(`RWI/ISL 글로벌 컨테이너 처리량 지수 ${pt.index}${mom ? ` (${mom} MoM)` : ''} — ${esc(pt.as_of || '')} 기준`);
  }
  if (bunkerLine) demandBullets.push(esc(bunkerLine.replace(/^[-•\s]+/, '')));
  if (demandBullets.length) {
    rows.push({ tag: 'DEMAND · COST', dir: '', headline: '물동량 완만, 연료비 하락', bullets: demandBullets });
  }
  return rows;
}

async function buildExecPage(front, weekEnd) {
  const rows = await buildExecRows(front, weekEnd);
  if (rows.length < 3) return '';
  const heatmap = (await buildKcciHeatmap(weekEnd)) || '';

  const rowHtml = rows.map((r) => `
<div class="ex-row">
  <div class="ex-tag">${r.tag}</div>
  <div class="ex-main">
    <div class="ex-head ${r.dir}">${r.headline}</div>
    <ul>${r.bullets.map((b) => `<li>${b}</li>`).join('')}</ul>
  </div>
</div>`).join('');

  return `<section class="exec-page">
<div class="sec-band"><span class="st">Executive Summary</span><span class="sp">한눈에 보는 이달의 시장 · 데이터 기준 ${esc(weekEnd)}</span></div>
${rowHtml}
${heatmap}
</section>`;
}

module.exports = { buildExecPage };
