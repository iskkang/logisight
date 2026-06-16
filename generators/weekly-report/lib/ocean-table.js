'use strict';
// freight_indices 행 배열 -> 해상 INDEX 마크다운 표. 순수 함수.
const LABEL = {
  SCFI: 'SCFI 종합', SCFI_USWC: 'SCFI 미주서안', SCFI_USEC: 'SCFI 미주동안',
  SCFI_EU: 'SCFI 유럽', KCCI: 'KCCI 종합', CCFI: 'CCFI 종합', WCI: 'WCI 종합', BDI: 'BDI',
};

function chg(p) {
  if (p == null) return '—';
  const dir = p > 0.05 ? '▲ ' : p < -0.05 ? '▼ ' : '';
  return `${dir}${p > 0 ? '+' : ''}${p.toFixed(1)}%`;
}

function mmdd(iso) {
  if (!iso) return '—';
  const [, m, d] = iso.split('-');
  return `${m}/${d}`;
}

function buildOceanTable(rows) {
  const valid = (rows || []).filter(r => r && r.value != null);
  if (!valid.length) return { table: '_해상 지표 데이터 미수집_', factText: '' };
  const head = '| 지수 | 최신값 | 기준일 | 전주 대비 |\n|---|---|---|---|';
  const body = valid.map(r =>
    `| ${LABEL[r.code] || r.code} | ${r.value}${r.unit === '$/FEU' ? '달러/FEU' : 'pt'} | ${mmdd(r.week_date)} | ${chg(r.wow)} |`);
  const table = [head, ...body].join('\n');
  return { table, factText: '출처: freight_indices(SCFI·KCCI·CCFI·WCI·BDI).' };
}

module.exports = { buildOceanTable };
