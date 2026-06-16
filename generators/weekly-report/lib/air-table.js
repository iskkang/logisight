'use strict';
// IATA iata-cargo.json -> 항공 권역 마크다운 표 + factText. 순수 함수.

function fmt(n) {
  if (n == null) return '—';
  return `${n > 0 ? '+' : ''}${n}%`;
}

function buildAirTable(iata) {
  const d = iata && iata.data;
  if (!d || !Array.isArray(d.regions) || !d.regions.length) {
    return { table: '_IATA 항공 데이터 미수집_', factText: '' };
  }
  const head = '| 권역 | 수요 CTK(YoY) | 공급 ACTK(YoY) |\n|---|---|---|';
  const rows = d.regions.map(r => `| ${r.region} | ${fmt(r.ctk_yoy)} | ${fmt(r.actk_yoy)} |`);
  const clf = d.headline
    ? ` 글로벌 적재율(CLF) ${d.headline.clf_level}%(${fmt(d.headline.clf_ppt).replace('%', '%p')}).`
    : '';
  const table = [head, ...rows].join('\n');
  const factText = `출처: IATA Air Cargo Market Analysis(iata-cargo, asOf ${d.asOf}).${clf}`;
  return { table, factText };
}

module.exports = { buildAirTable };
