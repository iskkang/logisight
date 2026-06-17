'use strict';
// logisight-core/src/server/signals.ts 의 compute* 로직 포팅(CommonJS, 순수).
// 입력 시계열: [{week_date|period, value}], 정렬은 내부에서 수행.

function pctile(values, current) {
  if (!values.length) return 0;
  // 프론트 server/signals.ts percentile52wValues 와 동일하게 v <= current (골든 패리티)
  const below = values.filter((v) => v <= current).length;
  return Math.round((below / values.length) * 100);
}
function momChange(series) {
  if (series.length < 2) return null;
  const s = [...series].sort((a, b) => String(a.k).localeCompare(String(b.k)));
  const l = s[s.length - 1], p = s[s.length - 2];
  if (l.value == null || p.value == null || p.value === 0) return null;
  return ((l.value - p.value) / p.value) * 100;
}

function computeOceanPressure(kcciSeries, asOf) {
  const valid = kcciSeries.filter((p) => p.value != null).sort((a, b) => a.week_date.localeCompare(b.week_date));
  if (valid.length < 6) return null;
  const last3 = valid.slice(-3).map((p) => p.value);
  const prev3 = valid.slice(-6, -3).map((p) => p.value);
  const avgLast = last3.reduce((s, v) => s + v, 0) / 3;
  const avgPrev = prev3.reduce((s, v) => s + v, 0) / 3;
  const wow = avgPrev === 0 ? 0 : ((avgLast - avgPrev) / avgPrev) * 100;
  const pct = pctile(valid.map((p) => p.value), avgLast);
  let state = 'normal';
  if (pct >= 80 && wow > 0) state = 'alert';
  else if (pct >= 70 && wow > 0) state = 'caution';
  else if (pct >= 60) state = 'observe';
  return {
    label: '해상 운임 압력', state, pct, wow, avgLast,
    basis: `KCCI 3주 평균 ${Math.round(avgLast).toLocaleString()} — 52주 백분위 ${pct}%, 직전 3주 평균比 ${wow >= 0 ? '+' : ''}${wow.toFixed(1)}%`,
    sources: ['KCCI'], asOf: asOf ?? valid.at(-1).week_date, confidence: valid.length >= 12 ? 'high' : 'medium',
  };
}

function computeGlobalMomentum(scfiSeries, wciSeries, asOf) {
  const scfi = scfiSeries.filter((p) => p.value != null).sort((a, b) => a.week_date.localeCompare(b.week_date));
  const wci = wciSeries.filter((p) => p.value != null).sort((a, b) => a.week_date.localeCompare(b.week_date));
  if (scfi.length < 5) return null;
  const scfiMoM = momChange(scfi.map((p) => ({ k: p.week_date, value: p.value })));
  if (scfiMoM == null) return null;
  const wciMoM = wci.length >= 5 ? momChange(wci.map((p) => ({ k: p.week_date, value: p.value }))) : null;
  const aligned = wciMoM != null && Math.sign(scfiMoM) === Math.sign(wciMoM);
  const mag = Math.abs(scfiMoM);
  let state = 'normal';
  if (mag >= 10) state = aligned ? 'alert' : 'caution';
  else if (mag >= 5) state = aligned ? 'caution' : 'observe';
  const alignText = wciMoM != null ? `WCI MoM ${wciMoM >= 0 ? '+' : ''}${wciMoM.toFixed(1)}%와 방향 ${aligned ? '정합' : '비정합'}` : 'WCI 데이터 없음';
  return {
    label: '글로벌 운임 모멘텀', state, scfiMoM, wciMoM, aligned,
    basis: `SCFI MoM ${scfiMoM >= 0 ? '+' : ''}${scfiMoM.toFixed(1)}% — ${alignText}`,
    sources: ['SCFI', ...(wciMoM != null ? ['WCI'] : [])], asOf: asOf ?? scfi.at(-1).week_date, confidence: aligned ? 'high' : 'medium',
  };
}

function computeAir(airMoM, routeLabel, oceanPct, asOf) {
  if (airMoM == null || Math.abs(airMoM) > 200) return null;
  const highOcean = oceanPct != null && oceanPct >= 70;
  let state = 'normal';
  if (Math.abs(airMoM) >= 10 && highOcean) state = 'caution';
  else if (Math.abs(airMoM) >= 10) state = 'observe';
  return {
    label: `항공 운임 변동 (${routeLabel})`, state, airMoM,
    basis: `MoM ${airMoM >= 0 ? '+' : ''}${airMoM.toFixed(1)}%${highOcean ? ' — 해상 압력 높음, 모달 전환 가능성 추정' : ''}`,
    sources: ['KITA 항공'], asOf: asOf ?? null, confidence: highOcean ? 'medium' : 'low',
  };
}

function computeBunker(vlsfoMoM, asOf) {
  if (vlsfoMoM == null) return null;
  let state = 'normal';
  if (Math.abs(vlsfoMoM) >= 10) state = 'caution';
  else if (Math.abs(vlsfoMoM) >= 5) state = 'observe';
  return {
    label: '벙커 비용', state, vlsfoMoM,
    basis: `VLSFO MoM ${vlsfoMoM >= 0 ? '+' : ''}${vlsfoMoM.toFixed(1)}% — 부대비용 영향 추정`,
    sources: ['VLSFO'], asOf: asOf ?? null, confidence: 'medium',
  };
}

module.exports = { pctile, momChange, computeOceanPressure, computeGlobalMomentum, computeAir, computeBunker };
