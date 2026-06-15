'use strict';
// Wave 1.5: Drewry Cancelled Sailings Tracker 헤드라인(살아있는 drewry-headline.js)을
// blank_sailings 테이블에 region='Drewry East-West'로 적재 → forecast tracker_quoted 소스 복구.
// EconDB('East Asia', 예정 스케줄·null 비율)는 결항 비율 소스로 쓰지 않는다.
const { buildDrewryHeadline } = require('../../../report/lib/drewry-headline');

const DREWRY_REGION = 'Drewry East-West';
const MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };

// "05 Jun 2026: ..." → '2026-06-05'
function parseDrewryAsOf(headline) {
  const m = String(headline && headline.sentence ? headline.sentence : '').match(/^(\d{1,2})\s+([A-Za-z]{3})[A-Za-z]*\s+(\d{4})/);
  if (!m) return null;
  const mo = MONTHS[m[2]];
  if (mo == null) return null;
  return `${m[3]}-${String(mo + 1).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

// 주간 1회: 헤드라인 fetch → blank_sailings 구조화 upsert(region 태그).
async function persistDrewryReading(supabase) {
  const h = await buildDrewryHeadline();
  if (!h || h.pct == null) {
    // [임시 진단] green 확인될 때까지 유지. 실패(미수집) 시에만 출력됨 → 정상 경로 영향 없음.
    console.error('[drewry][diag] raw meta :', (h && h.sentence) ? h.sentence : '(h.sentence 없음)');
    console.error('[drewry][diag] headline:', JSON.stringify(h, null, 2));
    return { ok: false, reason: 'drewry headline 미수집' };
  }
  const as_of = parseDrewryAsOf(h);
  if (!as_of) return { ok: false, reason: 'as_of 파싱 실패', sentence: h.sentence };
  const row = {
    week_start: as_of,
    region: DREWRY_REGION,
    blank_pct: h.pct,
    blanked_teu: h.blank,
    planned_teu: h.scheduled,
    source: h.source || 'Drewry Cancelled Sailings Tracker',
    fetched_at: new Date().toISOString(),
  };
  const { error } = await supabase.from('blank_sailings').upsert(row, { onConflict: 'week_start,region' });
  if (error) return { ok: false, reason: error.message };
  return { ok: true, as_of, pct: h.pct, blank: h.blank, scheduled: h.scheduled };
}

module.exports = { parseDrewryAsOf, persistDrewryReading, DREWRY_REGION };
