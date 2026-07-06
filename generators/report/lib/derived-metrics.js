'use strict';
// 파생 지표 순수 계산 (한중 스프레드·계약-스팟 갭·혼잡-운임 시그널·공시-실측 갭)
// 계산만 담당 — DB 조회/저장/LLM 없음. 입력 부족 시 항상 null (throw 금지).
//
// 입력 시리즈 규약: ocean-indices.loadGroup과 동일 — 최신순 정렬 [{week:'YYYY-MM-DD', v:Number}].
const { prevAtOrBefore } = require('./series-delta');

function weekOf(row) { return row.week ?? row.week_date; }

// ── laneSpread ────────────────────────────────────────────────────────────────
// 두 시리즈(최신순)의 "공통 최신주"를 찾아 spread(kcci - scfi)를 계산.
// 공통주가 전혀 없으면 각자 최신주 값을 그대로 병기(week: 'kcciWeek/scfiWeek')하고
// 4주전 비교는 생략(null) — 기준일 모호로 과대/과소비교 방지.
function findCommonLatestWeek(a, b) {
  const bWeeks = new Set(b.map(weekOf));
  for (const row of a) {
    const w = weekOf(row);
    if (w && bWeeks.has(w)) return w;
  }
  return null;
}

function laneSpread(kcciSeries, scfiSeries) {
  if (!Array.isArray(kcciSeries) || !kcciSeries.length) return null;
  if (!Array.isArray(scfiSeries) || !scfiSeries.length) return null;

  const commonWeek = findCommonLatestWeek(kcciSeries, scfiSeries);

  if (commonWeek) {
    const kRow = kcciSeries.find(r => weekOf(r) === commonWeek);
    const sRow = scfiSeries.find(r => weekOf(r) === commonWeek);
    const latest = { kcci: kRow.v, scfi: sRow.v, spread: kRow.v - sRow.v, week: commonWeek };

    const kPrev = prevAtOrBefore(kcciSeries, commonWeek, 28);
    const sPrev = prevAtOrBefore(scfiSeries, commonWeek, 28);
    const spread4wAgo = (kPrev && sPrev) ? kPrev.v - sPrev.v : null;
    const spreadChange = spread4wAgo != null ? latest.spread - spread4wAgo : null;

    return { latest, spread4wAgo, spreadChange };
  }

  // 공통주 없음 — 각자 최신주 병기, 4주전 비교 생략
  const kRow = kcciSeries[0];
  const sRow = scfiSeries[0];
  const latest = {
    kcci: kRow.v, scfi: sRow.v, spread: kRow.v - sRow.v,
    week: `${weekOf(kRow)}/${weekOf(sRow)}`,
  };
  return { latest, spread4wAgo: null, spreadChange: null };
}

// ── contractSpotGap ───────────────────────────────────────────────────────────
function pearson(pairs) {
  const n = pairs.length;
  const sx = pairs.reduce((s, p) => s + p[0], 0);
  const sy = pairs.reduce((s, p) => s + p[1], 0);
  const mx = sx / n, my = sy / n;
  let num = 0, dx2 = 0, dy2 = 0;
  for (const [x, y] of pairs) {
    const dx = x - mx, dy = y - my;
    num += dx * dy; dx2 += dx * dx; dy2 += dy * dy;
  }
  const denom = Math.sqrt(dx2 * dy2);
  return denom === 0 ? null : num / denom;
}

function contractSpotGap(ccfiSeries, scfiSeries, { weeks = 26 } = {}) {
  if (!Array.isArray(ccfiSeries) || !ccfiSeries.length) return null;
  if (!Array.isArray(scfiSeries) || !scfiSeries.length) return null;

  const scfiByWeek = new Map(scfiSeries.map(r => [weekOf(r), r.v]));
  const ccfiByWeek = new Map(ccfiSeries.map(r => [weekOf(r), r.v]));

  // 동일 주 매칭 → ratio 시리즈 (최신순, 최근 weeks주까지)
  const matched = ccfiSeries
    .filter(r => scfiByWeek.has(weekOf(r)))
    .map(r => ({ week: weekOf(r), v: r.v / scfiByWeek.get(weekOf(r)) }))
    .slice(0, weeks);
  if (!matched.length) return null;

  const ratioLatest = matched[0].v;
  const prevRatio = prevAtOrBefore(matched, matched[0].week, 28);
  const ratio4wAgo = prevRatio ? prevRatio.v : null;

  // 교차상관: corr(SCFI(t-k), CCFI(t)) 최대인 k (k=0..8, 매칭 주 8개 미만이면 null)
  let bestK = null, bestCorr = -Infinity;
  for (let k = 0; k <= 8; k++) {
    const pairs = [];
    for (const [t, ccfiV] of ccfiByWeek) {
      const targetWeek = new Date(new Date(t + 'T00:00:00Z').getTime() - k * 7 * 86400000)
        .toISOString().slice(0, 10);
      if (scfiByWeek.has(targetWeek)) pairs.push([scfiByWeek.get(targetWeek), ccfiV]);
    }
    if (pairs.length < 8) continue;
    const r = pearson(pairs);
    if (r != null && r > bestCorr) { bestCorr = r; bestK = k; }
  }
  const lagWeeks = bestK;
  const corrAtLag = bestK != null ? bestCorr : null;

  return { ratioLatest, ratio4wAgo, lagWeeks, corrAtLag };
}

// ── congestionRateSignal ──────────────────────────────────────────────────────
const QUADRANTS = {
  '1,1':   { quadrant: 'demand_pull',        label: '수요 견인 신호' },
  '1,-1':  { quadrant: 'supply_adjust',      label: '공급 조절 주도' },
  '-1,1':  { quadrant: 'bottleneck_slowdown', label: '병목 속 수요 둔화' },
  '-1,-1': { quadrant: 'easing',             label: '완화 국면' },
};
const CONGESTION_THRESHOLD = 1; // ±1%p — 임계 이내는 방향성 없음(보합)으로 처리

function direction(x) {
  return x > CONGESTION_THRESHOLD ? 1 : x < -CONGESTION_THRESHOLD ? -1 : 0;
}

function median(nums) {
  const sorted = nums.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function congestionRateSignal(congestionRows, scfiWow) {
  if (!Array.isArray(congestionRows) || !congestionRows.length) return null;
  if (typeof scfiWow !== 'number' || !Number.isFinite(scfiWow)) return null;

  const valid = congestionRows.map(r => r.wow_pct).filter(v => typeof v === 'number' && Number.isFinite(v));
  if (!valid.length) return null;

  const congestionWow = median(valid);
  const freightDir = direction(scfiWow);
  const congestDir = direction(congestionWow);
  const detail = `운임 WoW ${scfiWow}%, 항만 혼잡도 WoW 중앙값 ${congestionWow}%`;

  if (freightDir === 0 || congestDir === 0) {
    return { quadrant: 'flat', label: '보합권(신호 약함)', detail };
  }

  const { quadrant, label } = QUADRANTS[`${freightDir},${congestDir}`];
  return { quadrant, label, detail };
}

// ── kitaKcciGap ───────────────────────────────────────────────────────────────
// kitaLanes: [{destName, feu, yearMon}] (destName: 롱비치/뉴욕/로테르담 등, FEU 기준 최신값)
// kcciByCode: { KCCI_USWC: [{week,v}], ... } (ocean-indices loadGroup과 동일, 최신순)
const LANE_TO_KCCI = {
  '롱비치': 'KCCI_USWC',
  '뉴욕': 'KCCI_USEC',
  '로테르담': 'KCCI_NEU',
};

function kitaKcciGap(kitaLanes, kcciByCode) {
  if (!Array.isArray(kitaLanes) || !kitaLanes.length) return null;
  if (!kcciByCode || typeof kcciByCode !== 'object') return null;

  const out = [];
  for (const lane of kitaLanes) {
    const code = LANE_TO_KCCI[lane.destName];
    if (!code || lane.feu == null) continue;
    const series = kcciByCode[code];
    if (!Array.isArray(series) || !series.length) continue;
    const kcciRow = series[0];
    if (kcciRow.v == null) continue;

    out.push({
      lane: lane.destName,
      kita: lane.feu,
      kcci: kcciRow.v,
      gapPct: (lane.feu - kcciRow.v) / kcciRow.v * 100,
      week: weekOf(kcciRow),
      kitaMonth: lane.yearMon,
    });
  }
  return out.length ? out : null;
}

// ── 확장 지표 ────────────────────────────────────────────────────────────────

const OCEAN_LANES = ['KCCI_USWC', 'KCCI_USEC', 'KCCI_NEU', 'KCCI_MED', 'KCCI_ME',
                     'KCCI_AU', 'KCCI_SAE', 'KCCI_SAW', 'KCCI_ZAF', 'KCCI_WAF'];
const INTRA_LANES = ['KCCI_CN', 'KCCI_JP', 'KCCI_SEA'];

function laneMoM(series) {
  if (!series || series.length < 2) return null;
  const latest = series[0];
  const prev = prevAtOrBefore(series, weekOf(latest), 28);
  if (!prev || prev.v == null || prev.v === 0 || latest.v == null) return null;
  return ((latest.v - prev.v) / prev.v) * 100;
}

// 역내-원양 탈동조화: 원양 항로 평균 MoM vs 역내 항로 평균 MoM 격차(%p).
// 매달 한 숫자로 "원양 급등이 역내로 전이되는가"를 추적하는 자체 지표.
function intraOceanDecoupling(kcciByCode) {
  if (!kcciByCode) return null;
  const avg = (lanes) => {
    const vals = lanes.map((c) => laneMoM(kcciByCode[c])).filter((v) => v != null);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  };
  const oceanAvgMoM = avg(OCEAN_LANES);
  const intraAvgMoM = avg(INTRA_LANES);
  if (oceanAvgMoM == null || intraAvgMoM == null) return null;
  return { oceanAvgMoM, intraAvgMoM, gapPp: oceanAvgMoM - intraAvgMoM };
}

// 벙커-운임 괴리: 운임 MoM − 벙커유 MoM (%p). 양수 확대 = 연료비 대비 운임이
// 더 빠르게 올라 선사 마진이 확대되는 국면(BAF·EBS 협상의 정량 근거).
function bunkerFreightDivergence(freightSeries, bunkerSeries) {
  const freightMoM = laneMoM(freightSeries);
  const bunkerMoM = laneMoM(bunkerSeries);
  if (freightMoM == null || bunkerMoM == null) return null;
  return { freightMoM, bunkerMoM, gapPp: freightMoM - bunkerMoM };
}

module.exports = {
  laneSpread, contractSpotGap, congestionRateSignal, kitaKcciGap,
  intraOceanDecoupling, bunkerFreightDivergence,
};
