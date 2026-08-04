'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { fmtPct, fmtInt, sppiTable, portTable, tradeTable, commodityTable } = require('./tables');

// 첫 판은 증가를 ▲, 감소를 ▼로 그렸다. 일본 재무 표기에서 ▲는 마이너스이고
// 본문도 그렇게 쓴다('名古屋港は▲0.8%' = 감소) — 같은 문서에서 기호가 정반대를 뜻했다.
test('fmtPct: 마이너스는 ▲, 플러스는 +', () => {
  assert.equal(fmtPct(3.049), '+3.0%');
  assert.equal(fmtPct(-7.087), '▲7.1%');
  assert.equal(fmtPct(0), '+0.0%');
  assert.equal(fmtPct(null), '—');
});

test('fmtInt: 적자도 ▲로 쓴다', () => {
  assert.equal(fmtInt(-4099), '▲4,099');
  assert.equal(fmtInt(3393), '3,393');
});

// 표 전체에 ▼가 남아 있으면 안 된다.
test('표: 증가 화살표를 쓰지 않는다', () => {
  const facts = {
    sppi: { series: [{ name: 'a', yen: 1, contract: null, yoyYenPct: 5, yoyContractPct: null }] },
    port: { total: { teu: 1, exportTeu: 1, importTeu: 1, yoyPct: 0.1 }, ports: [{ name: 'p', teu: 1, exportTeu: 1, importTeu: 1, yoyPct: -7.1 }] },
  };
  for (const t of [sppiTable(facts), portTable(facts)]) assert.ok(!t.includes('▼'), t);
});

test('fmtInt: 천 단위 구분', () => {
  assert.equal(fmtInt(1177717), '1,177,717');
  assert.equal(fmtInt(null), '—');
});

const FACTS = {
  periods: { sppi: '2026-06', port: '2026-05', trade: '2026-06', commodity: '2026-06' },
  sppi: {
    period: '2026-06', baseYear: '2020', source: '日本銀行 SPPI',
    series: [
      { name: '外航貨物輸送', category: 'ocean', yen: 233.8, contract: 160.8, yoyYenPct: 52.8, yoyContractPct: 37.4 },
      { name: '内航貨物輸送', category: 'ocean', yen: 135.0, contract: null, yoyYenPct: 4.2, yoyContractPct: null },
    ],
  },
  port: {
    period: '2026-05', isPreliminary: true, source: '国土交通省 港湾統計',
    total: { teu: 1177717, exportTeu: 562219, importTeu: 615498, yoyPct: 0.128 },
    ports: [
      { name: '東京港', teu: 367332, exportTeu: 160049, importTeu: 207283, yoyPct: 0.058 },
      { name: '川崎港', teu: 6935, exportTeu: 3755, importTeu: 3180, yoyPct: -7.087 },
    ],
  },
  trade: {
    period: '2026-06', source: '財務省貿易統計',
    total: { exportJpy: 10927000000, importJpy: 11336000000, balanceJpy: -409000000, yoyExportPct: 19.3, yoyImportPct: 25.4 },
    countries: [
      { name: 'USA', exportJpy: 1928000000, importJpy: 1589000000, balanceJpy: 339000000, yoyExportPct: 12.9, yoyImportPct: 52.7 },
    ],
  },
  commodity: {
    period: '2026-06', source: '財務省貿易統計',
    export: [{ name: '機械類及び輸送用機器', valueJpy: 6156000000, sharePct: 56.34 }],
    import: [{ name: '鉱物性燃料', valueJpy: 2000000000, sharePct: 18.5 }],
  },
};

test('sppiTable: 마크다운 표 형식', () => {
  const t = sppiTable(FACTS);
  const lines = t.trim().split('\n');
  assert.ok(lines[0].startsWith('|'));
  assert.match(lines[1], /^\|[\s:|-]+\|$/); // 구분행
  assert.ok(t.includes('外航貨物輸送'));
  assert.ok(t.includes('233.8'));
  assert.ok(t.includes('160.8'));
});

// 계약통화 기준이 없는 계열은 빈칸이어야 한다. 0으로 채우면 거짓말이 된다.
test('sppiTable: 계약통화가 없으면 빈 표시', () => {
  const t = sppiTable(FACTS);
  const row = t.split('\n').find((l) => l.includes('内航貨物輸送'));
  assert.ok(row.includes('—'));
  assert.ok(!row.includes('0.0'));
});

test('sppiTable: 출처와 기준연도를 각주로 단다', () => {
  const t = sppiTable(FACTS);
  assert.match(t, /※/);
  assert.ok(t.includes('2020'));
  assert.ok(t.includes('日本銀行'));
});

test('portTable: 합계 행과 항만 행을 모두 담고 속보를 밝힌다', () => {
  const t = portTable(FACTS);
  assert.ok(t.includes('主要6港 合計'));
  assert.ok(t.includes('東京港'));
  assert.ok(t.includes('1,177,717'));
  assert.match(t, /速報/);
});

test('portTable: 감소한 항만은 ▲로 표기한다', () => {
  const t = portTable(FACTS);
  const kawasaki = t.split('\n').find((l) => l.includes('川崎港'));
  assert.ok(kawasaki.includes('▲7.1%'), kawasaki);
});

test('tradeTable: 금액을 억엔 단위로 환산한다', () => {
  const t = tradeTable(FACTS);
  // 10,927,000,000 千円 = 10兆9,270億円 → 109,270億円
  assert.ok(t.includes('109,270'));
  assert.ok(t.includes('USA'));
});

test('commodityTable: 구성비를 소수 1자리로', () => {
  const t = commodityTable(FACTS);
  assert.ok(t.includes('56.3%'));
  assert.ok(!t.includes('56.34'));
});

test('모든 표: 빈 데이터에서도 예외 없이 문자열을 낸다', () => {
  const empty = {
    periods: {}, sppi: { series: [] }, port: { total: null, ports: [] },
    trade: { total: null, countries: [] }, commodity: { export: [], import: [] },
  };
  for (const fn of [sppiTable, portTable, tradeTable, commodityTable]) {
    assert.equal(typeof fn(empty), 'string');
  }
});
