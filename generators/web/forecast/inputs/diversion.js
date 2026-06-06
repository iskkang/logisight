'use strict';
// T1-1: Red Sea / Cape of Good Hope Diversion (H5 effective capacity).
// Drewry Red Sea Diversion Tracker는 등록/로그인 필요(무료지만 게이트됨).
// → 어드민 수동 입력 폴백: `red_sea_diversion` 테이블을 격주 어드민이 채움.
// buildDiversion(rows): pure transform — SSOT 매핑:
//   우회 확대 = 유효 선복 −10~15% 효과 → effective_capacity_chg_pct.
// 참고 문헌: 케이프 루트 추가 항해일 ≈ 10~14일 → 유효 선복 −10~15% (SSOT 밴드).

// cape_share_pct(케이프 경유 선복 비율, 0~100) → effective_capacity_chg_pct 산출.
// 기준선: 수에즈 완전 정상화 시 cape_share_pct ≈ 20%(역사적 평시 기준).
// 우회 초과분(cape_share_pct - 20)이 유효 선복 감소로 전환.
// 10% 초과분당 −1.5% 유효 선복 감소(SSOT 밴드 −10~15% / 우회 초과 ~67~80% 기반).
// 케이프 비율 ≤ 20%: 정상화 → 선복 영향 없음(0). 케이프 비율 = 100%: 완전 우회 → −12%(밴드 중앙값).
const NORMAL_CAPE_SHARE = 20; // % — 수에즈 평시 케이프 비율 기준선
const SCALE_PCT_PER_EXCESS_10 = -1.5; // 10% 초과 케이프 비율당 유효 선복 변화(%)

function capeToCapacityChg(cape_share_pct) {
  if (cape_share_pct == null || !Number.isFinite(cape_share_pct)) return null;
  const excess = cape_share_pct - NORMAL_CAPE_SHARE;
  if (excess <= 0) return 0; // 정상화 → 영향 없음
  // 선형 매핑, SSOT 밴드 −10~15% 클램프
  const raw = (excess / 10) * SCALE_PCT_PER_EXCESS_10;
  return Math.round(Math.max(-15, Math.min(0, raw)) * 10) / 10;
}

// rows: red_sea_diversion 행. asof: Date.
// 반환: {effective_capacity_chg_pct, source_type, cape_share_pct, as_of, signal_age_days, source} | null
function buildDiversion(rows, asof) {
  const valid = (rows || []).filter((r) => {
    if (r.cape_share_pct == null) return false;
    const t = new Date(`${r.as_of}T00:00:00Z`).getTime();
    return Number.isFinite(t) && t <= (asof ? asof.getTime() : Date.now());
  });
  if (!valid.length) return null;
  const sorted = valid.sort((a, b) => new Date(b.as_of) - new Date(a.as_of));
  const latest = sorted[0];
  const t = new Date(`${latest.as_of}T00:00:00Z`).getTime();
  const asofMs = asof ? asof.getTime() : Date.now();
  const signalAgeDays = Math.round((asofMs - t) / 86400000);
  const cap = capeToCapacityChg(latest.cape_share_pct);
  return {
    effective_capacity_chg_pct: cap,
    source_type: 'admin_input',
    cape_share_pct: latest.cape_share_pct,
    suez_share_pct: latest.suez_share_pct ?? null,
    as_of: latest.as_of,
    signal_age_days: signalAgeDays,
    source: latest.source || 'Drewry Red Sea Diversion Tracker (admin-input)',
    note: latest.note || null,
  };
}

// Supabase에서 최근 격주 입력 2건 조회 (어드민 수동 입력분).
async function fetchDiversion(supabase, asof = new Date()) {
  const { data } = await supabase
    .from('red_sea_diversion')
    .select('as_of,cape_share_pct,suez_share_pct,source,note')
    .order('as_of', { ascending: false })
    .limit(4);
  return buildDiversion(data || [], asof);
}

module.exports = { buildDiversion, fetchDiversion, capeToCapacityChg, NORMAL_CAPE_SHARE };
