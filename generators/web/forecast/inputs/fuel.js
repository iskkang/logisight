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
  const prior = sorted.find((r) => (latestDate - new Date(`${r.obs_date}T00:00:00Z`)) >= 28 * 86400000);
  if (!prior) return null;
  const momPct = ((latest.price_usd - prior.price_usd) / prior.price_usd) * 100;
  const lagWeeks = Math.round(((asof - latestDate) / 86400000 / 7) * 10) / 10;
  return { fuel_mom_pct: Math.round(momPct * 10) / 10, fuel_obs_lag_weeks: lagWeeks };
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
