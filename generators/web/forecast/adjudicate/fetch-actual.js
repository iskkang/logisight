'use strict';
// metric_ref → 실측값. 'KCCI'/'SCFI'(freight_indices) 또는 'kita_sea_rates:origin-dest'.

function parseMetricRef(ref) {
  if (ref && ref.startsWith('kita_sea_rates:')) {
    const lane = ref.slice('kita_sea_rates:'.length);
    // 첫 하이픈에서 분리 — origin(한국 항구)은 하이픈이 없고, dest는 하이픈 포함 가능(예: Los-Angeles).
    const i = lane.indexOf('-');
    return { kind: 'kita', origin: i >= 0 ? lane.slice(0, i) : lane, dest: i >= 0 ? lane.slice(i + 1) : '' };
  }
  return { kind: 'index', code: ref };
}

// rows: [{value, date}]. horizon 당일 또는 그 직후의 가장 이른 관측을 실측으로.
function pickRealized(rows, horizonDate) {
  const onOrAfter = (rows || [])
    .filter((r) => r.value != null && String(r.date) >= String(horizonDate))
    .sort((a, b) => String(a.date).localeCompare(String(b.date))); // 오름차순
  return onOrAfter.length ? onOrAfter[0].value : null;
}

async function fetchActual(supabase, metricRef, horizonDate) {
  const m = parseMetricRef(metricRef);
  if (m.kind === 'index') {
    const { data } = await supabase
      .from('freight_indices')
      .select('value,week_date')
      .eq('index_code', m.code)
      .order('week_date', { ascending: false })
      .limit(20);
    return pickRealized((data || []).map((r) => ({ value: r.value, date: r.week_date })), horizonDate);
  }
  const { data } = await supabase
    .from('kita_sea_rates')
    .select('feu,year_mon')
    .eq('origin', m.origin)
    .eq('dest', m.dest)
    .order('year_mon', { ascending: false })
    .limit(6);
  // year_mon은 'YYYYMM' → 비교 위해 'YYYY-MM-01'로 정규화
  const norm = (ym) => `${String(ym).slice(0, 4)}-${String(ym).slice(4, 6)}-01`;
  return pickRealized((data || []).map((r) => ({ value: r.feu, date: norm(r.year_mon) })), horizonDate);
}

module.exports = { parseMetricRef, pickRealized, fetchActual };
