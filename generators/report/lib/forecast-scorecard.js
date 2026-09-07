'use strict';
// generators/report/lib/forecast-scorecard.js
// 월간 리포트 [전망] 클레임 스코어카드 — 전월(prevMonth) 전망을 이번 달 실측 지수와 대조 판정해
// 총론(index) 프롬프트에 "지난달 전망 점검" 블록으로 주입한다 (T4).

const { prevAtOrBefore } = require('./series-delta');

const FLAT_BAND_PCT = 1; // ±1%는 보합(flat) 처리

function fmtActual(pct, dir) {
  if (dir === 'flat') return `보합(${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%)`;
  if (dir === 'up')   return `▲+${pct.toFixed(1)}%`;
  return `▼-${Math.abs(pct).toFixed(1)}%`;
}

// claims: forecast-store.loadForecasts() 결과 — [{section, claim, metric, direction, horizon}]
// indexSeriesByMetric: {SCFI:[{week,v}]최신순, KCCI:[...], ...} (ocean-indices.loadGroup 결과와 동일 형태)
function judgeClaims(claims, indexSeriesByMetric) {
  return (claims || []).map((claim) => {
    // metric 또는 direction이 없으면 판정 불가 — 정성 처리 (방향 없는 주장을 miss로 오판하지 않음)
    if (!claim.metric || !claim.direction) {
      return { ...claim, verdict: 'qualitative', actual: '—' };
    }

    const series = indexSeriesByMetric && indexSeriesByMetric[claim.metric];
    if (!series || series.length < 2) {
      return { ...claim, verdict: 'qualitative', actual: '—' };
    }

    const latest = series[0];
    const prevRow = prevAtOrBefore(series, latest.week, 28);
    if (!prevRow || prevRow.v == null || prevRow.v === 0 || latest.v == null) {
      return { ...claim, verdict: 'qualitative', actual: '—' };
    }

    const pct = ((latest.v - prevRow.v) / prevRow.v) * 100;
    const actualDir = Math.abs(pct) <= FLAT_BAND_PCT ? 'flat' : (pct > 0 ? 'up' : 'down');
    const verdict = claim.direction === actualDir ? 'hit' : 'miss';

    return { ...claim, verdict, actual: fmtActual(pct, actualDir) };
  });
}

function truncateClaim(claim) {
  const s = String(claim || '');
  return s.length > 40 ? s.slice(0, 40) + '…' : s;
}

function verdictMark(verdict) {
  if (verdict === 'hit')  return '✓ 적중';
  if (verdict === 'miss') return '✗ 빗나감';
  return '—(정성)';
}

// judged: judgeClaims() 결과 / prevMonth: 'YYYY-MM' → {table, factText} (또는 judged 비면 null)
// 건수는 세지 말고 받아 쓰게 한다 ★
// judged 는 전체 주장에 판정(hit/miss/qualitative)을 붙인 것이라 judged.length 가 곧
// 총 건수다. 본문이 "총 N건 중 정량 M건, 나머지 K건"을 직접 세면 어긋난다 —— 세 숫자를
// 여기서 계산해 문장으로 준다. 오늘 QA 에 걸린 창작 수치들과 같은 처방이다.
function buildScorecardBlock(judged, prevMonth) {
  if (!judged || !judged.length) return null;

  const header = `| 전월(${prevMonth}) 전망 | 실측 | 판정 |`;
  const sep    = '|---|---|---|';
  const rows   = judged.map(
    (j) => `| ${truncateClaim(j.claim)} | ${j.actual} | ${verdictMark(j.verdict)} |`
  );
  const table = [header, sep, ...rows].join('\n');

  const hit  = judged.filter(j => j.verdict === 'hit').length;
  const miss = judged.filter(j => j.verdict === 'miss').length;
  const qual = judged.length - hit - miss;
  const countLine =
    `전망 원문 총 ${judged.length}건 — 정량 판정 ${hit + miss}건(적중 ${hit}·빗나감 ${miss}), 정성 ${qual}건.`
    + ` 본문에서 건수를 말할 때는 이 숫자만 쓰고 직접 세거나 더하지 말 것.`;

  const factText = [
    `## 지난달(${prevMonth}) 전망 점검(스코어카드 — 이 표를 "지난달 전망 점검" 소제목으로 본문에 포함, 적중·빗나감 모두 서술, 변명 금지)`,
    ...(countLine ? [countLine] : []),
    table,
  ].join('\n');

  return { table, factText };
}

module.exports = { judgeClaims, buildScorecardBlock };
