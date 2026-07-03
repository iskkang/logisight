'use strict';
const fs   = require('fs');
const path = require('path');
// Node 20 lacks native WebSocket; Supabase Realtime requires it
const ws = require('ws');
globalThis.WebSocket = ws;
const { createClient } = require('@supabase/supabase-js');

const NEWS_PATH = path.resolve(__dirname, '../../../content/drafts/latest-news.json');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = (SUPABASE_URL && SUPABASE_KEY)
  ? createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } })
  : null;

// lane_causal 안전망: 카테고리가 잘못 들어와도 운임·항로 무관 기사 차단.
// 정상 상태에선 Linerlytica Market Pulse(순수 항로 분석)만 lane_causal이므로 거의 안 걸림.
const LANE_CAUSAL_RELEVANCE = /freight rate|container rate|ocean rate|shipping rate|carrier earn|TEU|FEU|SCFI|WCI|FBX|shipper|blank sailing|capacity|bunker|surcharge|GRI|peak season|Hormuz.*shipping|shipping.*Hormuz|Red Sea.*shipping|shipping.*disruption|port congestion|trade lane|vessel supply|market pulse/i;

// ── (기존) 뉴스 아이템 로더 — run-section.js 호환 유지 ──
// TASK 4 (옵션 A): category 필터 제거 + air/risk 섹션 추가 → air/rail/policy 섹션 입력 확보
function titleKey(item) {
  return String(item?.title || item?.title_en || '')
    .toLowerCase()
    .replace(/&(?:amp|#038);/g, '&')
    .replace(/[^a-z0-9가-힣一-龥]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function loadAllMonthlyItems({ monthEnd } = {}) {
  if (!fs.existsSync(NEWS_PATH)) {
    console.error('ERROR: latest-news.json 없음 — npm run collect:monthly 먼저 실행하세요.');
    process.exit(1);
  }
  const data  = JSON.parse(fs.readFileSync(NEWS_PATH, 'utf-8'));
  // 최근 45일 (월간 리포트 신선도). monthEnd 지정 시 [monthEnd-45d, monthEnd]로 발행월 데이터 배제.
  const end   = monthEnd ? new Date(`${monthEnd}T23:59:59Z`).getTime() : Date.now();
  const start = end - 45 * 86400000;
  const all  = [
    ...(data.shipping || []),
    ...(data.air      || []),
    ...(data.rail     || []),
    ...(data.trade    || []),
    ...(data.risk     || []),
  ].filter(i => {
    if (!i.source || !i.url || !i.title || i.title.length < 10) return false;
    // 롤링 스냅샷의 낡은 기사·발행월 데이터 차단 — 유효한 날짜가 창 밖이면 제외
    if (i.published_at) {
      const t = Date.parse(i.published_at);
      if (!isNaN(t) && (t < start || t > end)) return false;
    }
    // lane_causal 항목은 운임 관련성 재확인 — 스냅샷 잔재 비운임 기사 차단
    if (i.category === 'lane_causal') {
      return LANE_CAUSAL_RELEVANCE.test(`${i.title} ${i.summary_en || ''}`);
    }
    return true;
  });

  const seen = new Set();
  const seenRailTitles = new Set();
  return all.filter(i => {
    if (seen.has(i.url)) return false;
    seen.add(i.url);
    if (i.section === 'rail') {
      const key = titleKey(i);
      if (key) {
        if (seenRailTitles.has(key)) return false;
        seenRailTitles.add(key);
      }
    }
    return true;
  });
}

// ── (신규) freight_indices 시계열 → 최신값·WoW·MoM ──
const CODES = ['SCFI', 'SCFI_USWC', 'SCFI_USEC', 'SCFI_EU', 'KCCI', 'CCFI', 'WCI', 'BDI'];
const LABEL = {
  SCFI:      'SCFI 종합',
  SCFI_USWC: 'SCFI 미주서안',
  SCFI_USEC: 'SCFI 미주동안',
  SCFI_EU:   'SCFI 유럽',
  KCCI:      'KCCI 종합',
  CCFI:      'CCFI 종합',
  WCI:       'WCI 종합',
  BDI:       'BDI',
};

async function loadIndexFactsheet({ weekEnd } = {}) {
  if (!supabase) {
    console.warn('⚠️ Supabase 미설정 — 지표 수치 없이 진행');
    return null;
  }
  const since = new Date(Date.now() - 80 * 86400000).toISOString().slice(0, 10);
  let q = supabase
    .from('freight_indices')
    .select('index_code,value,week_date,change_pct')
    .gte('week_date', since);
  if (weekEnd) q = q.lte('week_date', weekEnd);
  const { data, error } = await q
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
      unit:      code === 'WCI' ? '$/FEU' : 'point',
      // WoW는 저장된 연속 값으로 직접 계산(표의 값↔증감 정합 보장). 직전 값이 없을 때만 적재된 change_pct 사용.
      // (WCI change_pct는 Drewry 산문 파싱이라 부호 오류 가능 — shipping_indices.ts fetchWCI 참고)
      wow:       (wkAgo ? pct(latest.value, wkAgo.value) : latest.change_pct),
      mom:       moAgo ? pct(latest.value, moAgo.r.value) : null,
    });
  }
  return rows;
}

// null이면 단일 "—", 값이 있으면 "▲ +3.2%" 형태로 반환
function fmtChg(p) {
  if (p == null) return '—';
  const dir = p > 0.05 ? '▲ ' : p < -0.05 ? '▼ ' : '';
  return `${dir}${p > 0 ? '+' : ''}${p.toFixed(1)}%`;
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
    if (r.value == null) continue; // 값 없는 지수는 행 삭제 (A-1b)
    const v = r.unit === '$/FEU'
      ? `$${Math.round(r.value).toLocaleString()}/FEU`
      : `${Math.round(r.value).toLocaleString()}p`;
    lines.push(
      `| ${LABEL[r.code] || r.code} | ${v} | ${r.week_date} | ${fmtChg(r.wow)} | ${fmtChg(r.mom)} |`
    );
    facts.push(
      `${LABEL[r.code] || r.code} ${v} (기준주 ${r.week_date}, WoW ${fmtChg(r.wow)}, MoM ${fmtChg(r.mom)})`
    );
  }
  lines.push('');
  lines.push('※ 기준주는 각 지수 최종 공표 주차. MoM은 약 4주 전 주간 종가 대비 근사치이며, 격주 공표 지수는 직전 공표치를 기준으로 환산함. 출처: SSE·KOBC·SSE/CCFC·Drewry·Baltic Exchange.');
  return { table: lines.join('\n'), factText: facts.join('\n') };
}

module.exports = { loadAllMonthlyItems, loadIndexFactsheet, buildIndexTable };
