'use strict';
// T1-1: Red Sea / Cape of Good Hope Diversion (H5 effective capacity).
// Drewry Red Sea Diversion Tracker는 등록/로그인 필요(무료지만 게이트됨).
// → 어드민 수동 입력 폴백: `red_sea_diversion` 테이블을 격주 어드민이 채움.
// buildDiversion(rows): pure transform — SSOT 매핑:
//   우회 확대 = 유효 선복 −10~15% 효과 → effective_capacity_chg_pct.
// 참고 문헌: 케이프 루트 추가 항해일 ≈ 10~14일 → 유효 선복 −10~15% (SSOT 밴드).

// 결정 1 공식: eff_cap_chg = COEF × Δcape_share(pt, 최근 2회분 변화).
// 초기 계수(v1): 완전 우회(Δcape +100pt) ≈ −12%(H5 밴드 −10~15% 중앙). 분기 보정 대상.
// Δ가 음수(우회 완화)면 양수(유효 선복 회복). 클램프 [−15, +15].
const COEF_PER_CAPE_PT = -0.12;

function diversionToCapacityChg(deltaCapePt) {
  if (deltaCapePt == null || !Number.isFinite(deltaCapePt)) return null;
  const raw = COEF_PER_CAPE_PT * deltaCapePt;
  return Math.round(Math.max(-15, Math.min(15, raw)) * 10) / 10;
}

// rows: red_sea_diversion 행. asof: Date. Δ 산출에 최근 2건 필요.
// 반환: {effective_capacity_chg_pct, delta_cape_pt, source_type, cape_share_pct, as_of, signal_age_days, source} | null
function buildDiversion(rows, asof) {
  const valid = (rows || []).filter((r) => {
    if (r.cape_share_pct == null) return false;
    const t = new Date(`${r.as_of}T00:00:00Z`).getTime();
    return Number.isFinite(t) && t <= (asof ? asof.getTime() : Date.now());
  });
  if (valid.length < 2) return null; // Δ(최근 2회분 변화) 불가 → 결측(더미 금지)
  const sorted = valid.sort((a, b) => new Date(b.as_of) - new Date(a.as_of));
  const latest = sorted[0];
  const prev = sorted[1];
  const delta = latest.cape_share_pct - prev.cape_share_pct;
  const t = new Date(`${latest.as_of}T00:00:00Z`).getTime();
  const asofMs = asof ? asof.getTime() : Date.now();
  return {
    effective_capacity_chg_pct: diversionToCapacityChg(delta),
    delta_cape_pt: Math.round(delta * 10) / 10,
    source_type: 'admin_input',
    cape_share_pct: latest.cape_share_pct,
    suez_share_pct: latest.suez_share_pct ?? null,
    as_of: latest.as_of,
    signal_age_days: Math.round((asofMs - t) / 86400000),
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

module.exports = { buildDiversion, fetchDiversion, diversionToCapacityChg, COEF_PER_CAPE_PT };
