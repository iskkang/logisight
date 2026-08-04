'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { SECTIONS, generationOrder, outputOrder, slimFactsheet } = require('./sections');

test('SECTIONS: 총론·데이터 3축·맺음말', () => {
  assert.equal(SECTIONS.length, 5);
  assert.deepEqual(SECTIONS.map((s) => s.id), ['overview', 'freight', 'port', 'trade', 'closing']);
});

// 참조 리포트(한국 월간)가 02-1·02-2처럼 번호 붙은 소섹션을 갖는다.
// 소섹션마다 호출하면 실행이 배로 길어지므로 한 번의 생성 안에서 만든다.
test('SECTIONS: 데이터 섹션은 소섹션 구성을 갖는다', () => {
  for (const id of ['freight', 'port', 'trade']) {
    const s = SECTIONS.find((x) => x.id === id);
    assert.ok(Array.isArray(s.subsections) && s.subsections.length >= 2, `${id}: 소섹션 없음`);
    assert.ok(s.subsections.every((t) => t.startsWith(`${s.no}-`)), `${id}: 소섹션 번호 불일치`);
  }
});

// 총론·맺음말은 다른 섹션이 확정한 사실을 종합해야 하므로 마지막에 쓴다.
// 하지만 출력은 번호대로다.
test('generationOrder: 총론·맺음말이 마지막', () => {
  const order = generationOrder();
  assert.equal(order.length, 5);
  const lastTwo = order.slice(-2).map((s) => s.id).sort();
  assert.deepEqual(lastTwo, ['closing', 'overview']);
});

test('outputOrder: 번호대로', () => {
  assert.deepEqual(outputOrder().map((s) => s.no), ['01', '02', '03', '04', '05']);
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
