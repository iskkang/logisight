'use strict';
// 파생 지표 로더 — DB/캐시 조회 + derived-metrics(순수 함수) 결합 → factText 블록 생성.
// ocean-indices(loadGroup)와 kita-report(SEA_CACHE)만 의존한다.
// derived-metrics.js는 이 파일을 모르므로 순환 참조 없음.
const fs = require('fs');
const { loadGroup, KCCI_ORDER, SCFI_ORDER, CCFI_ORDER } = require('./ocean-indices');
const { SEA_CACHE } = require('./kita-report');
const { laneSpread, contractSpotGap, congestionRateSignal, kitaKcciGap, intraOceanDecoupling, bunkerFreightDivergence } = require('./derived-metrics');

function fmtPp(v) { return (v >= 0 ? '▲+' : '▼') + Math.abs(v).toFixed(1) + '%'; }

// ── KITA 해상 캐시 → [{destName, feu, yearMon}] 어댑터 ─────────────────────────
// kita-report.js는 표/factText만 반환하므로(원본 노선 리스트 미노출), 동일 캐시 파일을
// 여기서 직접 읽어 kitaKcciGap이 요구하는 shape으로 변환한다(kita-report.js 수정 없음).
function loadKitaLanes() {
  try {
    if (!fs.existsSync(SEA_CACHE)) return null;
    const cache = JSON.parse(fs.readFileSync(SEA_CACHE, 'utf-8'));
    if (!cache || !Array.isArray(cache.routes)) return null;

    const lanes = [];
    for (const r of cache.routes) {
      if (r.error || !Array.isArray(r.rates) || !r.rates.length) continue;
      let latest = null;
      for (let i = r.rates.length - 1; i >= 0; i--) {
        if (r.rates[i].feu != null) { latest = r.rates[i]; break; }
      }
      if (latest) lanes.push({ destName: r.destName, feu: latest.feu, yearMon: latest.yearMon });
    }
    return lanes.length ? lanes : null;
  } catch (_) { return null; }
}

// ── 포맷 헬퍼 ──────────────────────────────────────────────────────────────────
function fmtNum(n)    { return Math.round(n).toLocaleString('ko-KR'); }
function fmtSigned(n) { const r = Math.round(n); return (r >= 0 ? '+' : '') + r.toLocaleString('ko-KR'); }
function fmtPct1(n)   { return `${n.toFixed(1)}%`; }

// ── 한중발 스프레드(파생) ──────────────────────────────────────────────────────
const SPREAD_LANES = [
  { label: '종합',     kcci: 'KCCI',      scfi: 'SCFI' },
  { label: '미주서안', kcci: 'KCCI_USWC', scfi: 'SCFI_USWC' },
  { label: '미주동안', kcci: 'KCCI_USEC', scfi: 'SCFI_USEC' },
];

function buildSpreadBlock(kcciByCode, scfiByCode) {
  if (!kcciByCode || !scfiByCode) return null;
  const lines = [];
  for (const lane of SPREAD_LANES) {
    const r = laneSpread(kcciByCode[lane.kcci], scfiByCode[lane.scfi]);
    if (!r) continue;
    const { latest, spread4wAgo } = r;
    let trend = '';
    if (spread4wAgo != null) {
      const widened = Math.abs(latest.spread) - Math.abs(spread4wAgo);
      const word = widened < 0 ? '축소' : widened > 0 ? '확대' : '유지';
      trend = ` (4주 전 ${fmtSigned(spread4wAgo)} → ${word})`;
    }
    lines.push(
      `한중발 스프레드(${lane.label}): KCCI ${fmtNum(latest.kcci)} − SCFI ${fmtNum(latest.scfi)} = ${fmtSigned(latest.spread)}${trend}`
    );
  }
  if (!lines.length) return null;
  return { factText: ['## 한중발 스프레드(파생)', ...lines].join('\n') };
}

// ── 계약-스팟 갭(파생) ─────────────────────────────────────────────────────────
function buildGapBlock(ccfiByCode, scfiByCode) {
  if (!ccfiByCode || !scfiByCode) return null;
  const r = contractSpotGap(ccfiByCode.CCFI, scfiByCode.SCFI);
  if (!r) return null;
  const { ratioLatest, ratio4wAgo, lagWeeks, corrAtLag } = r;

  const lines = [
    `계약-스팟 갭(CCFI/SCFI 비율): ${fmtPct1(ratioLatest * 100)}` +
      (ratio4wAgo != null ? ` (4주 전 ${fmtPct1(ratio4wAgo * 100)})` : ''),
  ];
  if (lagWeeks != null) {
    lines.push(`SCFI→CCFI 전이 시차: ${lagWeeks}주 (상관계수 ${corrAtLag.toFixed(2)})`);
  }
  return { factText: ['## 계약-스팟 갭(파생)', ...lines].join('\n') };
}

// ── KITA 공시-실측 갭(파생) ────────────────────────────────────────────────────
function buildKitaGapBlock(kitaLanes, kcciByCode) {
  if (!kitaLanes || !kcciByCode) return null;
  const rows = kitaKcciGap(kitaLanes, kcciByCode);
  if (!rows) return null;
  const lines = rows.map(row =>
    `${row.lane}: KITA ${fmtNum(row.kita)} vs KCCI ${fmtNum(row.kcci)} — 갭 ${fmtPct1(row.gapPct)} (KITA ${row.kitaMonth} / KCCI ${row.week})`
  );
  return { factText: ['## KITA 공시-실측 갭(파생)', ...lines].join('\n') };
}

// ── 로더 ───────────────────────────────────────────────────────────────────────
async function buildDerivedMetrics({ weekEnd, congestion, kitaSea } = {}) {
  const [kcciByCode, scfiByCode, ccfiByCode, bunkerByCode] = await Promise.all([
    loadGroup(KCCI_ORDER, weekEnd),
    loadGroup(SCFI_ORDER, weekEnd),
    loadGroup(CCFI_ORDER, weekEnd),
    loadGroup(['VLSFO'], weekEnd),
  ]);

  const spreadBlock  = buildSpreadBlock(kcciByCode, scfiByCode);
  const gapBlock      = buildGapBlock(ccfiByCode, scfiByCode);
  const kitaGapBlock = buildKitaGapBlock(kitaSea, kcciByCode);

  // 확장 지표 ①: 역내-원양 탈동조화 (KCCI 원양 vs 역내 평균 MoM 격차)
  let decouplingBlock = null;
  const dec = intraOceanDecoupling(kcciByCode);
  if (dec) {
    decouplingBlock = { factText: [
      '## 역내-원양 탈동조화 지수(파생)',
      `원양 항로 평균 ${fmtPp(dec.oceanAvgMoM)} MoM vs 역내 항로 평균 ${fmtPp(dec.intraAvgMoM)} MoM — 탈동조화 폭 ${dec.gapPp.toFixed(1)}%p (KCCI 항로 평균, 계산 기준 명시 필수)`,
    ].join('\n') };
  }

  // 확장 지표 ②: 벙커-운임 괴리 (KCCI 종합 MoM − VLSFO MoM = 마진 방향 신호)
  let bunkerDivergenceBlock = null;
  const div = bunkerFreightDivergence(kcciByCode && kcciByCode.KCCI, bunkerByCode && bunkerByCode.VLSFO);
  if (div) {
    bunkerDivergenceBlock = { factText: [
      '## 벙커-운임 괴리(파생)',
      `KCCI 종합 ${fmtPp(div.freightMoM)} MoM vs VLSFO ${fmtPp(div.bunkerMoM)} MoM — 괴리 ${div.gapPp.toFixed(1)}%p (운임이 연료비를 크게 앞서는 폭 = 선사 마진 방향의 정량 신호)`,
    ].join('\n') };
  }

  let congestionSignalText = null;
  if (congestion && Array.isArray(congestion.rows)) {
    const scfiSeries = scfiByCode && scfiByCode.SCFI;
    let scfiWow = null;
    if (Array.isArray(scfiSeries) && scfiSeries.length >= 2 && scfiSeries[1].v) {
      scfiWow = Math.round(((scfiSeries[0].v - scfiSeries[1].v) / scfiSeries[1].v) * 1000) / 10;
    }
    const signal = congestionRateSignal(congestion.rows, scfiWow);
    if (signal) congestionSignalText = `혼잡-운임 교차 신호(파생): ${signal.label} — ${signal.detail}`;
  }

  return { spreadBlock, gapBlock, congestionSignalText, kitaGapBlock, decouplingBlock, bunkerDivergenceBlock };
}

module.exports = { buildDerivedMetrics, loadKitaLanes };
