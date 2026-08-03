'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { SECTIONS, generationOrder, outputOrder, slimFactsheet } = require('./sections');

test('SECTIONS: 4섹션, 데이터 축과 1:1', () => {
  assert.equal(SECTIONS.length, 4);
  assert.deepEqual(SECTIONS.map((s) => s.id), ['overview', 'freight', 'port', 'trade']);
});

// 총론은 다른 섹션이 확정한 사실을 종합해야 하므로 마지막에 쓴다.
// 하지만 독자는 맨 앞에서 읽는다. 생성 순서와 출력 순서를 분리한다.
test('generationOrder: 총론이 마지막', () => {
  assert.equal(generationOrder().at(-1).id, 'overview');
  assert.equal(generationOrder().length, 4);
});

test('outputOrder: 총론이 처음', () => {
  assert.equal(outputOrder()[0].id, 'overview');
  assert.deepEqual(outputOrder().map((s) => s.no), ['01', '02', '03', '04']);
});

// 목업에서 팩트시트 전량(6.9KB)을 넣었더니 thinking이 예산을 다 먹어 본문이 비었다.
// 섹션이 쓰지 않는 축은 빼야 한다.
const FACTS = {
  periods: { sppi: '2026-06', port: '2026-05', trade: '2026-06', commodity: '2026-06' },
  periodMismatch: true,
  gaps: ['為替の時系列がない'],
  sppi: { series: [{ name: '外航貨物輸送', yen: 233.8, contract: 160.8, yoyYenPct: 52.8, yoyContractPct: 37.4 }], signals: [{ series: '国際航空貨物輸送', note: 'x' }] },
  port: { total: { teu: 1177717 }, ports: [{ name: '東京港', teu: 367332, yoyPct: 0.058 }], isPreliminary: true },
  trade: { total: { exportJpy: 10927000000 }, countries: [{ name: 'USA', exportJpy: 1928000000, yoyExportPct: 12.9 }] },
  commodity: { export: [{ name: '機械類', valueJpy: 6156000000, sharePct: 56.3 }] },
};

test('slimFactsheet: 섹션이 쓰는 축만 남긴다', () => {
  const port = slimFactsheet(FACTS, 'port');
  assert.ok(port.port);
  assert.ok(!port.sppi);
  assert.ok(!port.trade);
});

test('slimFactsheet: 무역 섹션은 국가·품목 두 축을 함께 받는다', () => {
  const trade = slimFactsheet(FACTS, 'trade');
  assert.ok(trade.trade);
  assert.ok(trade.commodity);
  assert.ok(!trade.sppi);
});

// 기준월 불일치·결측은 어느 섹션이든 지켜야 하는 제약이라 항상 넣는다.
test('slimFactsheet: periods·periodMismatch·gaps는 모든 섹션에 포함', () => {
  for (const id of ['freight', 'port', 'trade', 'overview']) {
    const s = slimFactsheet(FACTS, id);
    assert.ok(s.periods, `${id}: periods 누락`);
    assert.equal(s.periodMismatch, true, `${id}: periodMismatch 누락`);
    assert.ok(Array.isArray(s.gaps), `${id}: gaps 누락`);
  }
});

// 총론은 원자료가 아니라 앞 섹션의 요지를 받는다. 숫자를 다시 굴리면 어긋난다.
test('slimFactsheet: 총론은 축 데이터 대신 signals만 받는다', () => {
  const ov = slimFactsheet(FACTS, 'overview');
  assert.ok(!ov.port);
  assert.ok(!ov.trade);
  assert.ok(ov.signals);
});

test('slimFactsheet: 크기가 원본보다 작다', () => {
  const full = JSON.stringify(FACTS).length;
  for (const id of ['freight', 'port', 'trade', 'overview']) {
    assert.ok(JSON.stringify(slimFactsheet(FACTS, id)).length < full, `${id}: 슬림화 안 됨`);
  }
});
