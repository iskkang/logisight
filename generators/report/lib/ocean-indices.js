'use strict';
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env.local') });
if (typeof globalThis.WebSocket === 'undefined') { try { globalThis.WebSocket = require('ws'); } catch (_) {} }
const { createClient } = require('@supabase/supabase-js');
const { LABELS } = require('./chart-data');
const { buildBlankSailings } = require('./blank-sailings');
const { buildIntraAsia }    = require('./intra-asia');
const { prevAtOrBefore }    = require('./series-delta');

function sb() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } }
  );
}

const KCCI_ORDER = [
  'KCCI',
  'KCCI_USWC', 'KCCI_USEC', 'KCCI_NEU', 'KCCI_MED', 'KCCI_ME',
  'KCCI_AU',   'KCCI_SAE',  'KCCI_SAW', 'KCCI_ZAF', 'KCCI_WAF',
  'KCCI_CN',   'KCCI_JP',   'KCCI_SEA',
];
const SCFI_ORDER = ['SCFI', 'SCFI_USWC', 'SCFI_EU', 'SCFI_USEC'];
const CCFI_ORDER = ['CCFI'];
const WCI_ORDER  = ['WCI', 'WCI_SHA_RTM', 'WCI_SHA_GOA', 'WCI_SHA_LAX', 'WCI_SHA_NYC'];
const BDI_ORDER  = ['BDI'];
const BUNKER_ORDER = ['VLSFO', 'HSFO'];   // 02-8 정량 — freight_index_excel(oneksa) 주간 적재

const WCI_CODES = new Set(WCI_ORDER);

async function loadGroup(codes, weekEnd) {
  let q = sb().from('freight_indices')
    .select('index_code,week_date,value')
    .in('index_code', codes);
  if (weekEnd) q = q.lte('week_date', weekEnd);
  const { data, error } = await q
    .order('week_date', { ascending: false })
    .limit(codes.length * 14);   // up to ~12 weeks + buffer per code

  if (error || !data || !data.length) return null;

  const byCode = {};
  for (const r of data) {
    if (r.value == null) continue;
    (byCode[r.index_code] = byCode[r.index_code] || []).push({
      week: r.week_date,
      v:    Number(r.value),
    });
  }
  for (const code of Object.keys(byCode)) {
    byCode[code].sort((a, b) => b.week.localeCompare(a.week));
  }
  return byCode;
}

function fmtVal(v, code) {
  if (v == null || isNaN(v)) return '—';
  const n = Math.round(v);
  return WCI_CODES.has(code)
    ? `$${n.toLocaleString('ko-KR')}`
    : n.toLocaleString('ko-KR');
}

function fmtChg(curr, prev) {
  if (prev == null || curr == null || prev === 0) return '—';
  const pct = ((curr - prev) / prev) * 100;
  const dir = pct > 0.05 ? '▲ ' : pct < -0.05 ? '▼ ' : '';   // 보합(±0.05%p)은 기호 없이 — 스타일 가이드 §13-4
  return `${dir}${Math.abs(pct).toFixed(1)}%`;
}

function render(byCode, order, opts = {}) {
  const {
    chgLabel1 = '전주대비',
    chgLabel2 = '전월대비',
    chgDays1  = 7,    // 전주 = 직전 공표주
    chgDays2  = 28,   // 전월 = −28일 이전 최근접 공표주 — 01 총론 표(index-factsheet)와 동일 공용 규칙(series-delta)
    unitNote  = '',
    source    = '',
  } = opts;

  if (!byCode) return { table: '', factText: '' };

  const tableRows = [];
  const factLines = [];
  let latestWeek  = '';

  for (const code of order) {
    const s = byCode[code];
    if (!s || !s.length) {
      tableRows.push(`| ${LABELS[code] || code} | — | — | — |`);
      continue;
    }
    if (!latestWeek) latestWeek = s[0].week;

    const latest = s[0].v;
    const prev1  = (chgDays1 === 7 ? s[1] : prevAtOrBefore(s, s[0].week, chgDays1))?.v ?? null;
    const prev2  = prevAtOrBefore(s, s[0].week, chgDays2)?.v ?? null;

    const valStr  = fmtVal(latest, code);
    const chg1Str = fmtChg(latest, prev1);
    const chg2Str = fmtChg(latest, prev2);

    tableRows.push(`| ${LABELS[code] || code} | ${valStr} | ${chg1Str} | ${chg2Str} |`);
    factLines.push(
      `${LABELS[code] || code}(${code}): ${valStr} ${chgLabel1}=${chg1Str} ${chgLabel2}=${chg2Str} (${s[0].week})`
    );
  }

  const unitPart = unitNote ? ` (${unitNote})` : '';
  const header   = `| 지수/항로 | 최신값${unitPart} | ${chgLabel1} | ${chgLabel2} |`;
  const sep      = `|-----------|---------|---------|---------|`;
  const srcLine  = source
    ? `※ ${latestWeek} 기준. 출처: ${source}.`
    : `※ ${latestWeek} 기준.`;

  const table = [header, sep, ...tableRows, '', srcLine].join('\n');
  return { table, factText: factLines.join('\n') };
}

async function buildOceanIndices({ weekEnd } = {}) {
  const [[kcci, scfi, ccfi, wci, bdi, bunker], blankData, intraData] = await Promise.all([
    Promise.all([
      loadGroup(KCCI_ORDER, weekEnd),
      loadGroup(SCFI_ORDER, weekEnd),
      loadGroup(CCFI_ORDER, weekEnd),
      loadGroup(WCI_ORDER, weekEnd),
      loadGroup(BDI_ORDER, weekEnd),
      loadGroup(BUNKER_ORDER, weekEnd),
    ]),
    buildBlankSailings(),
    buildIntraAsia({ weekEnd }),
  ]);

  const blocks = [
    {
      id: 'kcci', chart: 'ocean_kcci', headingKw: ['02-1', 'KCCI'],
      ...render(kcci, KCCI_ORDER, { source: 'KOBC' }),
    },
    {
      id: 'scfi', chart: 'ocean_scfi', headingKw: ['02-2', 'SCFI'],
      ...render(scfi, SCFI_ORDER, { source: 'SSE(상하이항운교역소)' }),
    },
    {
      id: 'ccfi', chart: 'ocean_ccfi', headingKw: ['02-3', 'CCFI'],
      ...render(ccfi, CCFI_ORDER, { source: 'SSE/CCFC' }),
    },
    {
      id: 'wci', chart: 'ocean_wci', headingKw: ['02-4', 'WCI'],
      // WCI도 DB에 주간 적재 — 종전 prevIdx1=1을 '전월대비'로 라벨하던 오표기 제거, 표준 전주/전월 규칙 사용
      ...render(wci, WCI_ORDER, { unitNote: 'USD/FEU', source: 'Drewry' }),
    },
    {
      id: 'bdi', chart: 'ocean_bdi', headingKw: ['02-5', 'BDI'],
      ...render(bdi, BDI_ORDER, { source: 'Baltic Exchange' }),
    },
    {
      // 02-8 벙커유 정량 — 표 없이 정성 서술만 하던 페이지에 실측 주입(방향 환각 차단)
      id: 'bunker', chart: null, headingKw: ['02-8', '벙커'],
      ...render(bunker, BUNKER_ORDER, { unitNote: 'USD/톤', source: 'oneksa 주간 벙커 시세' }),
    },
    {
      id:        'blank_sailings',
      chart:     null,
      headingKw: ['02-6', '블랭크', '결항'],
      table:     blankData?.table    ?? null,
      factText:  blankData?.factText ?? null,
      notice:    '이번 회차 블랭크 세일링 정량 블록 생략 — Drewry 공개 헤드라인 미수집.',
      omitWhenEmpty: true,
    },
    {
      id:        'intra_asia',
      chart:     'ocean_intra_asia',
      headingKw: ['02-7', '역내', 'Intra'],
      table:     intraData?.table    ?? null,
      factText:  intraData?.factText ?? null,
      notice:    '이번 회차 역내 운임 데이터 미수집 — Supabase 조회 실패.',
    },
  ];

  const factText = [
    '[해운 운임 지수 최신값 — 이 수치만 사용, 다른 숫자 생성 금지]',
    ...blocks.filter(b => b.factText).map(b => `# ${b.id.toUpperCase()}\n${b.factText}`),
  ].join('\n');

  return { blocks, factText };
}

module.exports = {
  buildOceanIndices,
  loadGroup,
  KCCI_ORDER, SCFI_ORDER, CCFI_ORDER, WCI_ORDER, BDI_ORDER,
};
