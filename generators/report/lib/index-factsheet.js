'use strict';
const fs   = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const NEWS_PATH = path.resolve(__dirname, '../../../content/drafts/latest-news.json');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = (SUPABASE_URL && SUPABASE_KEY)
  ? createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } })
  : null;

// ── (기존) 뉴스 아이템 로더 — run-section.js 호환 유지 ──
// TASK 4 (옵션 A): category 필터 제거 + air/risk 섹션 추가 → air/rail/policy 섹션 입력 확보
function loadAllMonthlyItems() {
  if (!fs.existsSync(NEWS_PATH)) {
    console.error('ERROR: latest-news.json 없음 — npm run collect:monthly 먼저 실행하세요.');
    process.exit(1);
  }
  const data = JSON.parse(fs.readFileSync(NEWS_PATH, 'utf-8'));
  const all  = [
    ...(data.shipping || []),
    ...(data.air      || []),
    ...(data.rail     || []),
    ...(data.trade    || []),
    ...(data.risk     || []),
  ].filter(i => i.source && i.url && i.title && i.title.length >= 10);

  const seen = new Set();
  return all.filter(i => {
    if (seen.has(i.url)) return false;
    seen.add(i.url);
    return true;
  });
}

// ── (신규) freight_indices 시계열 → 최신값·WoW·MoM ──
const CODES = ['SCFI', 'SCFI_USWC', 'SCFI_USEC', 'SCFI_EU', 'KCCI', 'CCFI', 'WCI', 'FBX', 'BDI', 'HRCI'];
const LABEL = {
  SCFI:      'SCFI 종합',
  SCFI_USWC: 'SCFI 미주서안',
  SCFI_USEC: 'SCFI 미주동안',
  SCFI_EU:   'SCFI 유럽',
  KCCI:      'KCCI 종합',
  CCFI:      'CCFI 종합',
  WCI:       'WCI 종합',
  FBX:       'FBX 글로벌',
  BDI:       'BDI',
  HRCI:      'HRCI',
};

async function loadIndexFactsheet() {
  if (!supabase) {
    console.warn('⚠️ Supabase 미설정 — 지표 수치 없이 진행');
    return null;
  }
  const since = new Date(Date.now() - 80 * 86400000).toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from('freight_indices')
    .select('index_code,value,week_date,change_pct')
    .gte('week_date', since)
    .order('week_date', { ascending: false });
  if (error) {
    console.warn('⚠️ freight_indices 조회 실패:', error.message);
    return null;
  }
  if (!data || !data.length) return null;

  const byCode = {};
  for (const r of data) (byCode[r.index_code] = byCode[r.index_code] || []).push(r);

  const pct = (cur, prev) =>
    (prev != null && prev !== 0 && cur != null) ? ((cur - prev) / prev) * 100 : null;

  const rows = [];
  for (const code of CODES) {
    const s = (byCode[code] || []).sort((a, b) => b.week_date.localeCompare(a.week_date));
    if (!s.length) { rows.push({ code, value: null }); continue; }
    const latest = s[0];
    const wkAgo  = s[1] || null;
    const target = new Date(new Date(latest.week_date).getTime() - 28 * 86400000);
    const moAgo  = s.slice(1).reduce((best, r) => {
      const d = Math.abs(new Date(r.week_date) - target);
      return (!best || d < best.d) ? { r, d } : best;
    }, null);
    rows.push({
      code,
      value:     latest.value,
      week_date: latest.week_date,
      unit:      (code === 'WCI' || code === 'FBX') ? '$/FEU' : 'point',
      wow:       latest.change_pct ?? (wkAgo ? pct(latest.value, wkAgo.value) : null),
      mom:       moAgo ? pct(latest.value, moAgo.r.value) : null,
    });
  }
  return rows;
}

function arrow(p) {
  if (p == null) return '—';
  if (p > 0.05)  return '▲';
  if (p < -0.05) return '▼';
  return '-';
}
function fpct(p) {
  if (p == null) return '—';
  return `${p > 0 ? '+' : ''}${p.toFixed(1)}%`;
}

function buildIndexTable(rows) {
  if (!rows) {
    return {
      table:    '_지표 데이터 미수집 — 지표 대시보드 점검 필요_',
      factText: '',
    };
  }
  const lines = [
    '| 지수 | 최신값 | 기준주 | WoW | MoM |',
    '|------|--------|--------|-----|-----|',
  ];
  const facts = [];
  for (const r of rows) {
    if (r.value == null) {
      lines.push(`| ${LABEL[r.code] || r.code} | 데이터 미수집 | — | — | — |`);
      continue;
    }
    const v = r.unit === '$/FEU'
      ? `$${Math.round(r.value).toLocaleString()}/FEU`
      : `${Math.round(r.value).toLocaleString()}p`;
    lines.push(
      `| ${LABEL[r.code] || r.code} | ${v} | ${r.week_date} | ${arrow(r.wow)} ${fpct(r.wow)} | ${arrow(r.mom)} ${fpct(r.mom)} |`
    );
    facts.push(
      `${LABEL[r.code] || r.code} ${v} (기준주 ${r.week_date}, WoW ${fpct(r.wow)}, MoM ${fpct(r.mom)})`
    );
  }
  lines.push('');
  lines.push('※ MoM은 약 4주 전 주간값 대비 근사치 (oneksa 격주 데이터 기준)');
  return { table: lines.join('\n'), factText: facts.join('\n') };
}

module.exports = { loadAllMonthlyItems, loadIndexFactsheet, buildIndexTable };
