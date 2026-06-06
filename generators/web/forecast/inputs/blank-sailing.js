'use strict';
// supply.blank_sailing 조립 — blank_sailings 테이블(주간 이력)에서 결정적으로.
// region 'East Asia' = transpacific proxy(한국발). 방향은 전주 대비 blank_pct 변화로.

function magnitudeClass(ratio) {
  if (ratio == null) return 'unknown';
  if (ratio >= 15) return 'major';
  if (ratio >= 7) return 'moderate';
  return 'minor';
}

// rows: blank_sailings 행(최신순). asof: Date.
function buildBlankSailing(rows, asof) {
  if (!rows || !rows.length) return { source_type: 'none' };
  const sorted = [...rows].sort((a, b) => new Date(b.week_start) - new Date(a.week_start));
  const latest = sorted[0];
  const prev = sorted[1];
  let direction = 'stable';
  if (prev && latest.blank_pct != null && prev.blank_pct != null) {
    const delta = latest.blank_pct - prev.blank_pct;
    if (delta > 1) direction = 'expanding';
    else if (delta < -1) direction = 'easing';
  }
  const t = new Date(`${latest.week_start}T00:00:00Z`).getTime();
  const ageDays = Number.isFinite(t) ? Math.round((asof - t) / 86400000) : null;
  return {
    source_type: 'tracker_quoted',
    ratio_pct: latest.blank_pct != null ? latest.blank_pct : null,
    direction,
    magnitude_class: magnitudeClass(latest.blank_pct),
    independent_sources: 1,
    geo_scope: 'trade_level_proxy',
    signal_age_days: ageDays,
  };
}

// region='East Asia' 최근 8주를 읽어 transform.
async function fetchBlankSailing(supabase, asof = new Date()) {
  const { data } = await supabase
    .from('blank_sailings')
    .select('week_start,region,blank_pct,source')
    .eq('region', 'East Asia')
    .order('week_start', { ascending: false })
    .limit(8);
  return buildBlankSailing(data || [], asof);
}

module.exports = { buildBlankSailing, fetchBlankSailing, magnitudeClass };
