'use strict';
// v1.4: china_factor — 해상·한국발 전용. 부산은 중국발 기간항로 경유항이라 선복·결항이 중국 물량에 좌우됨.
//  - scfi_mom_pct: SCFI 2주 누적 모멘텀(중국발 수급 프록시).
//  - scfi_vs_kr_spread: SCFI−KCCI 2주 모멘텀 차로 상대 강도(widening|stable|narrowing).
//  - china_export_signal: 해관총서·관세 구조화 소스 없음 → 현재 null(결측, 추후 보강).

// points: [{value, date}] 최신순. 2주(인덱스 0 vs 2) 누적 변화% — 데이터 부족 시 null.
function pct2w(points) {
  const v = (points || []).filter((p) => p.value != null).map((p) => p.value);
  if (v.length < 3) return null;
  const cur = v[0];
  const wk2 = v[2];
  return wk2 ? Math.round(((cur - wk2) / wk2) * 1000) / 10 : null;
}

function buildChinaFactor(scfiPoints, kcciPoints) {
  const scfi_mom_pct = pct2w(scfiPoints);
  const kcci2w = pct2w(kcciPoints);
  let scfi_vs_kr_spread = null;
  if (scfi_mom_pct != null && kcci2w != null) {
    const diff = scfi_mom_pct - kcci2w;
    if (diff > 1) scfi_vs_kr_spread = 'widening';
    else if (diff < -1) scfi_vs_kr_spread = 'narrowing';
    else scfi_vs_kr_spread = 'stable';
  }
  const evidence = [];
  if (scfi_mom_pct != null) evidence.push(`SCFI 2주 ${scfi_mom_pct > 0 ? '+' : ''}${scfi_mom_pct}%`);
  if (scfi_vs_kr_spread) evidence.push(`SCFI−KCCI ${scfi_vs_kr_spread}`);
  return {
    scfi_mom_pct,
    scfi_vs_kr_spread,
    china_export_signal: null, // 해관총서/관세 구조화 소스 없음 → 결측(더미 금지)
    evidence,
  };
}

async function fetchChinaFactor(supabase) {
  const read = async (code) => {
    const { data } = await supabase
      .from('freight_indices')
      .select('value,week_date')
      .eq('index_code', code)
      .order('week_date', { ascending: false })
      .limit(6);
    return (data || []).map((r) => ({ value: r.value, date: r.week_date }));
  };
  const [scfi, kcci] = await Promise.all([read('SCFI'), read('KCCI')]);
  return buildChinaFactor(scfi, kcci);
}

module.exports = { buildChinaFactor, fetchChinaFactor, pct2w };
