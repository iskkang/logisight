'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { SECTIONS, generationOrder, outputOrder, slimFactsheet } = require('./sections');

// 구성은 한국판과 같은 모드별이다(해운·항공·철도·항만·무역).
// 지수별로 나누면 독자가 "우리 화물이 어느 모드냐"로 찾지 못한다.
test('SECTIONS: 모드별 구성 — 총론·해운·항공·철도·항만·무역·전망', () => {
  assert.equal(SECTIONS.length, 7);
  assert.deepEqual(SECTIONS.map((s) => s.id),
    ['overview', 'ocean', 'air', 'rail', 'port', 'trade', 'closing']);
});

// 리포트의 핵심은 세계와 일본을 맞대는 것이다. 해운 섹션이 두 축을 함께 받아야 성립한다.
test('SECTIONS: 해운 섹션은 세계 스팟과 일본 SPPI를 함께 받는다', () => {
  // supply — Drewry 欠航便数. 스팟 운임의 배경을 공급 쪽에서 말할 수 있는 유일한 계열이다.
  assert.deepEqual(SECTIONS.find((s) => s.id === 'ocean').axes, ['global', 'sppi', 'supply']);
});

// SPPI 13계열을 모든 섹션에 넣으면 본문이 계열 나열로 흐른다.
test('slimFactsheet: SPPI를 모드별로 잘라 넣는다', () => {
  const facts = {
    ...FACTS,
    sppi: {
      ...FACTS.sppi,
      series: [
        { name: '外航貨物輸送', category: 'ocean', yen: 233.8, contract: 160.8 },
        { name: '国際航空貨物輸送', category: 'air', yen: 142.4, contract: 98.1 },
        { name: '道路貨物輸送', category: 'land', yen: 111.6, contract: null },
      ],
      signals: [{ series: '国際航空貨物輸送', note: 'x' }],
    },
  };
  assert.deepEqual(slimFactsheet(facts, 'ocean').sppi.series.map((s) => s.name), ['外航貨物輸送']);
  assert.deepEqual(slimFactsheet(facts, 'air').sppi.series.map((s) => s.name), ['国際航空貨物輸送']);
  assert.deepEqual(slimFactsheet(facts, 'rail').sppi.series.map((s) => s.name), ['道路貨物輸送']);
});

// 잘라낸 계열의 signal이 남으면 본문이 없는 계열을 다루라는 지시를 받는다.
test('slimFactsheet: 잘린 계열의 signal도 함께 뺀다', () => {
  const facts = {
    ...FACTS,
    sppi: {
      ...FACTS.sppi,
      series: [{ name: '外航貨物輸送', category: 'ocean', yen: 233.8, contract: 160.8 }],
      signals: [{ series: '国際航空貨物輸送', note: 'x' }],
    },
  };
  assert.deepEqual(slimFactsheet(facts, 'ocean').sppi.signals, []);
});

// 전망의 근거는 "세계 스팟이 주간으로 먼저 나온다"는 공표 시차다.
test('SECTIONS: 전망 섹션은 세계 지수를 직접 본다', () => {
  assert.deepEqual(SECTIONS.find((s) => s.id === 'closing').axes, ['global']);
});

// 참조 리포트(한국 월간)가 02-1·02-2처럼 번호 붙은 소섹션을 갖는다.
// 소섹션마다 호출하면 실행이 배로 길어지므로 한 번의 생성 안에서 만든다.
test('SECTIONS: 데이터 섹션은 소섹션 구성을 갖는다', () => {
  for (const id of ['ocean', 'air', 'rail', 'port', 'trade']) {
    const s = SECTIONS.find((x) => x.id === id);
    assert.ok(Array.isArray(s.subsections) && s.subsections.length >= 2, `${id}: 소섹션 없음`);
    assert.ok(s.subsections.every((t) => t.startsWith(`${s.no}-`)), `${id}: 소섹션 번호 불일치`);
  }
});

// 총론·맺음말은 다른 섹션이 확정한 사실을 종합해야 하므로 마지막에 쓴다.
// 하지만 출력은 번호대로다.
test('generationOrder: 총론·전망이 마지막', () => {
  const order = generationOrder();
  assert.equal(order.length, 7);
  const lastTwo = order.slice(-2).map((s) => s.id).sort();
  assert.deepEqual(lastTwo, ['closing', 'overview']);
});

test('outputOrder: 번호대로', () => {
  assert.deepEqual(outputOrder().map((s) => s.no), ['01', '02', '03', '04', '05', '06', '07']);
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
  for (const id of ['ocean', 'port', 'trade', 'overview']) {
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
  for (const id of ['ocean', 'port', 'trade', 'overview']) {
    assert.ok(JSON.stringify(slimFactsheet(FACTS, id)).length < full, `${id}: 슬림화 안 됨`);
  }
});

// 표와 본문이 같은 금액을 1억엔 다르게 적은 적이 있다(総輸入 표 113,365 vs 본문 11兆3364억).
// 표는 반올림, 본문은 모델이 千円에서 직접 버림 환산했기 때문이다.
// 이제 모델에게는 환산된 億円만 넘긴다 — 표와 같은 함수를 거친 값이어야 한다.
test('슬림 팩트시트의 금액은 표와 같은 億円 값이다', () => {
  const { okuInt } = require('./tables');
  const facts = {
    periods: {}, gaps: [],
    trade: {
      total: { exportJpy: 10926534582, importJpy: 11336461191, balanceJpy: -409926609 },
      countries: [{ name: '米国', exportJpy: 1927863207, importJpy: 1588542604, balanceJpy: 339320603 }],
    },
    commodity: { export: [{ name: '機械類', valueJpy: 6156259844 }], import: [] },
  };
  const slim = slimFactsheet(facts, 'trade');

  assert.equal(slim.trade.total.importOku, okuInt(11336461191));
  assert.equal(slim.trade.total.importOku, 113365, '버림이면 113364가 된다');
  assert.equal(slim.trade.total.balanceOku, -4099);
  assert.equal(slim.trade.countries[0].exportOku, 19279, '버림이면 19278이 된다');
  assert.equal(slim.commodity.export[0].valueOku, 61563);

  // 千円 원자료는 넘기지 않는다. 남겨두면 모델이 그쪽으로 환산해버린다.
  assert.equal(slim.trade.total.importJpy, undefined);
  assert.equal(slim.trade.countries[0].exportJpy, undefined);
  assert.equal(slim.commodity.export[0].valueJpy, undefined);
});
