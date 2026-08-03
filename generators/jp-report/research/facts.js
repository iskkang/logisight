'use strict';
// generators/jp-report/research/facts.js
// 일본판 월간 리포트 팩트시트 — DB 행 → 구조화 사실.
// 순수 함수만 둔다(I/O 없음). DB 조회는 build-factsheet.js가 한다.
//
// 설계 근거는 실제 LLM 샘플에서 나온 실패다:
//  - 계약통화 지수가 100 미만인데(달러 기준 2020년 수준 이하) 언급하지 않았다 → signals로 강제 노출
//  - 환율 데이터가 없는데 "円安"를 논했다 → gaps로 결측을 명시
//  - 무역 6월과 항만 5월을 섞으면서 그 사실을 감췄다 → periodMismatch로 표시

const PORT_NAMES = {
  JPTYO: '東京港',
  JPKWS: '川崎港',
  JPYOK: '横浜港',
  JPNGO: '名古屋港',
  JPOSA: '大阪港',
  JPUKB: '神戸港',
};

/** 지수의 기준연도 값. 계약통화 기준이 이보다 낮으면 실질 운임이 기준연도 이하라는 뜻이다. */
const INDEX_BASE = 100;

const pct = (cur, prev) =>
  (Number.isFinite(cur) && Number.isFinite(prev) && prev !== 0 ? (cur / prev - 1) * 100 : null);

const period = ({ year, month }) => `${year}-${String(month).padStart(2, '0')}`;

function buildSppiFacts(rows, prevRows, at) {
  const byName = new Map();
  for (const r of rows) {
    if (r.basis === 'ex_tax') continue; // 소비세 제외는 본계열과 값이 같아 리포트에 쓰지 않는다
    const entry = byName.get(r.series_name) || { name: r.series_name, category: r.category, yen: null, contract: null };
    entry[r.basis] = Number(r.value);
    if (r.category) entry.category = r.category;
    byName.set(r.series_name, entry);
  }
  const prev = new Map();
  for (const r of prevRows) prev.set(`${r.series_name}_${r.basis}`, Number(r.value));

  const series = [...byName.values()].map((s) => ({
    ...s,
    yoyYenPct: pct(s.yen, prev.get(`${s.name}_yen`)),
    yoyContractPct: pct(s.contract, prev.get(`${s.name}_contract`)),
  }));

  // 계약통화 기준이 100 미만인 계열은 반드시 다뤄야 하는 앵글이다.
  const signals = series
    .filter((s) => Number.isFinite(s.contract) && s.contract < INDEX_BASE)
    .map((s) => ({
      kind: 'contract_below_base',
      series: s.name,
      contract: s.contract,
      yen: s.yen,
      note: `契約通貨ベース ${s.contract} — 基準年(2020年)を下回る。円ベース ${s.yen} との差は為替要因。`,
    }));

  return { period: period(at), baseYear: '2020', unit: 'index', series, signals };
}

function buildPortFacts(rows, at) {
  const total = rows.find((r) => r.port_code === 'JP_MAJOR6') || null;
  const ports = rows
    .filter((r) => r.port_code !== 'JP_MAJOR6' && PORT_NAMES[r.port_code])
    .map((r) => ({
      code: r.port_code,
      name: PORT_NAMES[r.port_code],
      teu: Number(r.teu),
      exportTeu: r.export_teu === null ? null : Number(r.export_teu),
      importTeu: r.import_teu === null ? null : Number(r.import_teu),
      yoyPct: r.yoy_pct === null ? null : Number(r.yoy_pct),
    }))
    .sort((a, b) => b.teu - a.teu);

  return {
    period: period(at),
    unit: 'TEU',
    scope: '主要6港 外国貿易コンテナ',
    // 속보와 확보는 모집단·확정도가 다르다. 어느 쪽인지 밝히지 않으면 비교가 어긋난다.
    isPreliminary: Boolean(total ? total.is_preliminary : rows[0] && rows[0].is_preliminary),
    total: total
      ? {
        teu: Number(total.teu),
        exportTeu: total.export_teu === null ? null : Number(total.export_teu),
        importTeu: total.import_teu === null ? null : Number(total.import_teu),
        yoyPct: total.yoy_pct === null ? null : Number(total.yoy_pct),
      }
      : null,
    ports,
  };
}

function buildTradeFacts(rows, at) {
  const total = rows.find((r) => r.country_name === 'Grand Total') || null;
  const countries = rows
    .filter((r) => !r.is_aggregate)
    .map((r) => ({
      name: r.country_name,
      exportJpy: r.export_jpy === null ? null : Number(r.export_jpy),
      importJpy: r.import_jpy === null ? null : Number(r.import_jpy),
      balanceJpy:
        r.export_jpy === null || r.import_jpy === null ? null : Number(r.export_jpy) - Number(r.import_jpy),
      yoyExportPct: r.yoy_export_pct === null ? null : Number(r.yoy_export_pct),
      yoyImportPct: r.yoy_import_pct === null ? null : Number(r.yoy_import_pct),
    }))
    .sort((a, b) => (b.exportJpy || 0) - (a.exportJpy || 0));

  return {
    period: period(at),
    unit: 'thousand_jpy',
    total: total
      ? {
        exportJpy: Number(total.export_jpy),
        importJpy: Number(total.import_jpy),
        balanceJpy: Number(total.export_jpy) - Number(total.import_jpy),
        yoyExportPct: total.yoy_export_pct === null ? null : Number(total.yoy_export_pct),
        yoyImportPct: total.yoy_import_pct === null ? null : Number(total.yoy_import_pct),
      }
      : null,
    countries,
  };
}

function buildCommodityFacts(rows, at) {
  const group = (direction) => {
    const agg = new Map();
    for (const r of rows) {
      if (r.direction !== direction) continue;
      agg.set(r.commodity_name, (agg.get(r.commodity_name) || 0) + Number(r.value_jpy));
    }
    const sum = [...agg.values()].reduce((a, b) => a + b, 0);
    return [...agg.entries()]
      .map(([name, valueJpy]) => ({ name, valueJpy, sharePct: sum ? (valueJpy / sum) * 100 : null }))
      .sort((a, b) => b.valueJpy - a.valueJpy);
  };
  return { period: period(at), unit: 'thousand_jpy', export: group('export'), import: group('import') };
}

/** 현재 수집 범위에 없는 것. 없는 줄 모르고 쓰면 근거 없는 서술이 나온다. */
const KNOWN_GAPS = [
  '為替(円ドルレート)の時系列 — 円安要因を数値で裏付けられない',
  '航路別荷動き(JPMAC) — 船腹・消化率に触れられない',
  '日本発着ブランクセーリング — 供給side の説明ができない',
];

function buildFactsheet({ sppi, port, trade, commodity }) {
  const periods = {
    sppi: sppi.period,
    port: port.period,
    trade: trade.period,
    commodity: commodity.period,
  };
  const distinct = new Set(Object.values(periods));
  return {
    generatedFor: periods.trade, // 무역이 가장 최신이라 리포트 기준월로 삼는다
    periods,
    // 기준월이 섞였다는 사실을 감추면 "6월 리포트"에 5월 항만 수치가 조용히 들어간다.
    periodMismatch: distinct.size > 1,
    gaps: [...KNOWN_GAPS],
    sppi,
    port,
    trade,
    commodity,
  };
}

module.exports = {
  PORT_NAMES,
  buildSppiFacts,
  buildPortFacts,
  buildTradeFacts,
  buildCommodityFacts,
  buildFactsheet,
};
