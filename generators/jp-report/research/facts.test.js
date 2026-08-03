'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildSppiFacts,
  buildPortFacts,
  buildTradeFacts,
  buildCommodityFacts,
  buildFactsheet,
} = require('./facts');

// ── SPPI ────────────────────────────────────────────────────────────────
const sppiRows = [
  { series_name: '外航貨物輸送', category: 'ocean', basis: 'yen', value: 233.8 },
  { series_name: '外航貨物輸送', category: 'ocean', basis: 'contract', value: 160.8 },
  { series_name: '国際航空貨物輸送', category: 'air', basis: 'yen', value: 142.4 },
  { series_name: '国際航空貨物輸送', category: 'air', basis: 'contract', value: 98.1 },
];
const sppiPrev = [
  { series_name: '外航貨物輸送', basis: 'yen', value: 153.0 },
  { series_name: '外航貨物輸送', basis: 'contract', value: 117.0 },
  { series_name: '国際航空貨物輸送', basis: 'yen', value: 96.2 },
];

test('buildSppiFacts: 기준별 값을 한 계열로 묶고 전년비를 계산', () => {
  const f = buildSppiFacts(sppiRows, sppiPrev, { year: 2026, month: 6 });
  const ocean = f.series.find((s) => s.name === '外航貨物輸送');
  assert.equal(ocean.yen, 233.8);
  assert.equal(ocean.contract, 160.8);
  assert.ok(Math.abs(ocean.yoyYenPct - 52.8) < 0.1);
  assert.ok(Math.abs(ocean.yoyContractPct - 37.4) < 0.1);
});

// 샘플 리포트가 놓친 앵글이다. 계약통화 지수가 100 미만이면
// "달러 기준으로는 2020년 수준 이하"라는 뜻이라 반드시 다뤄야 한다.
test('buildSppiFacts: 계약통화 지수 100 미만을 신호로 표시', () => {
  const f = buildSppiFacts(sppiRows, sppiPrev, { year: 2026, month: 6 });
  const signal = f.signals.find((s) => s.series === '国際航空貨物輸送');
  assert.ok(signal, '계약통화 98.1 계열이 신호로 잡혀야 한다');
  assert.equal(signal.kind, 'contract_below_base');
  assert.ok(!f.signals.some((s) => s.series === '外航貨物輸送'));
});

test('buildSppiFacts: 전년 데이터가 없으면 전년비는 null — 임의로 채우지 않는다', () => {
  const f = buildSppiFacts(sppiRows, [], { year: 2026, month: 6 });
  assert.equal(f.series[0].yoyYenPct, null);
});

// ── 港湾 ────────────────────────────────────────────────────────────────
const portRows = [
  { port_code: 'JP_MAJOR6', teu: 1177717, export_teu: 562219, import_teu: 615498, yoy_pct: 0.128, is_preliminary: true },
  { port_code: 'JPTYO', teu: 367332, export_teu: 160049, import_teu: 207283, yoy_pct: 0.058, is_preliminary: true },
  { port_code: 'JPKWS', teu: 6935, export_teu: 3755, import_teu: 3180, yoy_pct: -7.087, is_preliminary: true },
];

test('buildPortFacts: 합계와 항만별을 분리하고 항만명을 붙인다', () => {
  const f = buildPortFacts(portRows, { year: 2026, month: 5 });
  assert.equal(f.total.teu, 1177717);
  assert.equal(f.ports.length, 2);
  assert.equal(f.ports.find((p) => p.code === 'JPTYO').name, '東京港');
  assert.ok(!f.ports.some((p) => p.code === 'JP_MAJOR6'));
});

test('buildPortFacts: 속보 여부를 명시 — 확보와 섞어 쓰면 안 된다', () => {
  const f = buildPortFacts(portRows, { year: 2026, month: 5 });
  assert.equal(f.isPreliminary, true);
});

test('buildPortFacts: TEU 내림차순 정렬', () => {
  const f = buildPortFacts(portRows, { year: 2026, month: 5 });
  assert.equal(f.ports[0].code, 'JPTYO');
});

// ── 貿易 ────────────────────────────────────────────────────────────────
const tradeRows = [
  { country_name: 'Grand Total', is_aggregate: true, export_jpy: 10927000000, import_jpy: 11336000000, yoy_export_pct: 19.3, yoy_import_pct: 12.1 },
  { country_name: 'CHINA', is_aggregate: false, export_jpy: 1824000000, import_jpy: 2645000000, yoy_export_pct: 17.6, yoy_import_pct: 8.0 },
  { country_name: 'USA', is_aggregate: false, export_jpy: 1928000000, import_jpy: 1589000000, yoy_export_pct: 12.9, yoy_import_pct: 5.0 },
];

test('buildTradeFacts: 총계와 국가를 분리한다', () => {
  const f = buildTradeFacts(tradeRows, { year: 2026, month: 6 });
  assert.equal(f.total.exportJpy, 10927000000);
  assert.equal(f.countries.length, 2);
  assert.ok(!f.countries.some((c) => c.name === 'Grand Total'));
});

test('buildTradeFacts: 수출 내림차순, 무역수지 포함', () => {
  const f = buildTradeFacts(tradeRows, { year: 2026, month: 6 });
  assert.equal(f.countries[0].name, 'USA');
  assert.equal(f.countries.find((c) => c.name === 'CHINA').balanceJpy, 1824000000 - 2645000000);
});

// ── 品目 ────────────────────────────────────────────────────────────────
const commodityRows = [
  { direction: 'export', commodity_name: '機械類及び輸送用機器', value_jpy: 6156000000 },
  { direction: 'export', commodity_name: '化学製品', value_jpy: 1088000000 },
  { direction: 'import', commodity_name: '鉱物性燃料', value_jpy: 2000000000 },
];

test('buildCommodityFacts: 방향별로 나누고 구성비를 계산', () => {
  const f = buildCommodityFacts(commodityRows, { year: 2026, month: 6 });
  assert.equal(f.export.length, 2);
  assert.equal(f.import.length, 1);
  const top = f.export[0];
  assert.equal(top.name, '機械類及び輸送用機器');
  assert.ok(Math.abs(top.sharePct - 85.0) < 0.1);
});

// ── 팩트시트 조립 ────────────────────────────────────────────────────────
test('buildFactsheet: 축별 기준월이 다르면 불일치를 표시한다', () => {
  const fs = buildFactsheet({
    sppi: buildSppiFacts(sppiRows, sppiPrev, { year: 2026, month: 6 }),
    port: buildPortFacts(portRows, { year: 2026, month: 5 }),
    trade: buildTradeFacts(tradeRows, { year: 2026, month: 6 }),
    commodity: buildCommodityFacts(commodityRows, { year: 2026, month: 6 }),
  });
  assert.equal(fs.periodMismatch, true);
  assert.equal(fs.periods.port, '2026-05');
  assert.equal(fs.periods.trade, '2026-06');
});

test('buildFactsheet: 기준월이 같으면 불일치 아님', () => {
  const fs = buildFactsheet({
    sppi: buildSppiFacts(sppiRows, sppiPrev, { year: 2026, month: 6 }),
    port: buildPortFacts(portRows, { year: 2026, month: 6 }),
    trade: buildTradeFacts(tradeRows, { year: 2026, month: 6 }),
    commodity: buildCommodityFacts(commodityRows, { year: 2026, month: 6 }),
  });
  assert.equal(fs.periodMismatch, false);
});

// 없는 데이터를 아는 상태로 써야 한다. 샘플 리포트가 환율 데이터 없이 "円安"를 논했다.
test('buildFactsheet: 결측 데이터를 명시한다', () => {
  const fs = buildFactsheet({
    sppi: buildSppiFacts(sppiRows, sppiPrev, { year: 2026, month: 6 }),
    port: buildPortFacts(portRows, { year: 2026, month: 5 }),
    trade: buildTradeFacts(tradeRows, { year: 2026, month: 6 }),
    commodity: buildCommodityFacts(commodityRows, { year: 2026, month: 6 }),
  });
  assert.ok(fs.gaps.length > 0);
  assert.ok(fs.gaps.some((g) => /為替|환율/.test(g)));
});
