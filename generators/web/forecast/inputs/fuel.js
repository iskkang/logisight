'use strict';
// cost(유가) 조립 — bunker_prices VLSFO/Singapore 일간에서 MoM.
// 최신가 vs 약 28일 전(이전 관측 중 28일 이상 과거인 가장 가까운 행) 비교.

function buildFuel(rows, asof) {
  if (!rows || rows.length < 2) return null;
  const sorted = [...rows]
    .filter((r) => r.price_usd != null)
    .sort((a, b) => new Date(b.obs_date) - new Date(a.obs_date));
  if (sorted.length < 2) return null;
  const latest = sorted[0];
  const latestDate = new Date(`${latest.obs_date}T00:00:00Z`);
  const ageOf = (r) => latestDate - new Date(`${r.obs_date}T00:00:00Z`);
  const PREF = 28 * 86400000;
  const MIN = 7 * 86400000;
  // 우선 ~1개월(≥28일) 전 관측. 없으면 ≥7일 전 중 가장 오래된 관측으로 fallback(approx 플래그) —
  // 벙커 이력이 28일 미만일 때 cost를 결측에서 빼내기 위함. 더미·이전값 대체가 아니라 실측 단축 구간.
  let prior = sorted.find((r) => ageOf(r) >= PREF);
  let approx = false;
  if (!prior) {
    const cand = sorted.filter((r) => ageOf(r) >= MIN);
    prior = cand.length ? cand[cand.length - 1] : null; // 가용 범위 내 최장 구간
    approx = true;
  }
  if (!prior || prior.price_usd === 0) return null; // 0 division 방지(불량 ETL 행)
  const momPct = ((latest.price_usd - prior.price_usd) / prior.price_usd) * 100;
  if (!Number.isFinite(momPct)) return null;
  const spanDays = Math.round(ageOf(prior) / 86400000);
  const lagWeeks = Math.round(((asof - latestDate) / 86400000 / 7) * 10) / 10;
  return {
    fuel_mom_pct: Math.round(momPct * 10) / 10,
    fuel_obs_lag_weeks: lagWeeks,
    obs_span_days: spanDays,
    approx, // true면 28일 미만 단축 구간(data_quality_flags 기록 대상)
  };
}

async function fetchFuel(supabase, asof = new Date()) {
  const { data } = await supabase
    .from('bunker_prices')
    .select('obs_date,price_usd,grade,port')
    .eq('grade', 'VLSFO')
    .eq('port', 'Singapore')
    .order('obs_date', { ascending: false })
    .limit(45);
  return buildFuel(data || [], asof);
}

module.exports = { buildFuel, fetchFuel };
