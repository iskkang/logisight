'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildSppiFacts,
  buildPortFacts,
  buildTradeFacts,
  countryJa,
  buildCommodityFacts,
  buildFactsheet,
  buildSupplyFacts,
  buildRailFacts,
  fxContribution,
  fxContributionYoy,
  buildGlobalHistory,
  buildSppiHistory,
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

// 검수에서 「出典名を断定的に付与している」로 걸렸다. 출처가 팩트시트에 없으면
// 본문이 기관명을 써도 검수자가 확인할 수 없다.
test('buildSppiFacts: 출처를 함께 담는다', () => {
  const f = buildSppiFacts(sppiRows, sppiPrev, { year: 2026, month: 6 });
  assert.ok(f.source && f.source.length > 0);
  assert.match(f.source, /日本銀行/);
});

test('buildPortFacts·buildTradeFacts·buildCommodityFacts: 각 축이 출처를 갖는다', () => {
  assert.match(buildPortFacts(portRows, { year: 2026, month: 5 }).source, /国土交通省/);
  assert.match(buildTradeFacts(tradeRows, { year: 2026, month: 6 }).source, /財務省/);
  assert.match(buildCommodityFacts(commodityRows, { year: 2026, month: 6 }).source, /財務省/);
});

// 검수가 「外航貨物輸送には為替要因の注記がない」로 반려했다.
// 두 기준의 차이가 환율이라는 건 지수의 정의이지 특정 계열의 특성이 아니다.
// 팩트시트에 정의를 담지 않으면 검수자가 계열마다 근거를 요구한다.
test('buildSppiFacts: 두 기준의 정의를 담는다', () => {
  const f = buildSppiFacts(sppiRows, sppiPrev, { year: 2026, month: 6 });
  assert.ok(f.basisNote, 'basisNote 누락');
  assert.match(f.basisNote, /為替/);
  assert.match(f.basisNote, /契約通貨/);
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
  assert.equal(f.countries[0].name, '米国');
  assert.equal(f.countries.find((c) => c.name === '中国').balanceJpy, 1824000000 - 2645000000);
});

// 재무성 원본은 'HG KONG' 'SNGAPOR' 같은 영문 약어다. 표만 영문으로 남으면
// 일본어 리포트로서 어색하고, 본문 번역을 모델에 맡기면 오역 위험이 남는다.
test('countryJa: 영문 약어를 일본어명으로 바꾼다', () => {
  assert.equal(countryJa('HG KONG'), '香港');
  assert.equal(countryJa('SNGAPOR'), 'シンガポール');
  assert.equal(countryJa('AUSTRAL'), 'オーストラリア');
});

test('countryJa: 매핑에 없으면 원문을 그대로 쓴다', () => {
  assert.equal(countryJa('NEWLAND'), 'NEWLAND');
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
//
// 다만 환율은 더 이상 결손이 아니다 — SPPI의 円ベース÷契約通貨ベース로 수치화한다.
// 결손 목록은 "정말 없는 것"만 담아야 한다. 메울 수 있는 것을 결손으로 남기면
// 본문이 쓸 수 있는 데이터를 두고 "말할 수 없다"를 쓴다.
test('buildFactsheet: 결측 데이터를 명시한다', () => {
  const fs = buildFactsheet({
    sppi: buildSppiFacts(sppiRows, sppiPrev, { year: 2026, month: 6 }),
    port: buildPortFacts(portRows, { year: 2026, month: 5 }),
    trade: buildTradeFacts(tradeRows, { year: 2026, month: 6 }),
    commodity: buildCommodityFacts(commodityRows, { year: 2026, month: 6 }),
  });
  assert.ok(fs.gaps.length > 0);
  assert.ok(fs.gaps.some((g) => /JPMAC/.test(g)), '航路別荷動きは本当に無い');
  assert.ok(!fs.gaps.some((g) => /為替/.test(g)), '為替は fxSinceBasePct で数値化できる');
});

// ── 추이(차트 전용) ──────────────────────────────────────────────────────
// 系列ごとに公表日が違う。日付の和集合を軸にし、欠測は null のまま残さないと
// 図が「その週も観測があった」ように見えてしまう。

const weekRows = [
  { index_code: 'SCFI', week_date: '2026-07-27', value: 3206 },
  { index_code: 'SCFI', week_date: '2026-07-20', value: 3061 },
  { index_code: 'CCFI', week_date: '2026-07-20', value: 1300 },
  { index_code: 'BDI', week_date: '2026-07-27', value: 1800 },   // 컨테이너가 아니라 추이에서 뺀다
  { index_code: 'SCFI', week_date: '2026-07-13', value: null },
];

test('buildGlobalHistory: 컨테이너 계열만 시간순으로 모은다', () => {
  const h = buildGlobalHistory(weekRows);
  assert.deepEqual(h.weeks, ['2026-07-20', '2026-07-27']);
  assert.deepEqual(h.series.map((s) => s.code), ['SCFI', 'CCFI']);
  assert.deepEqual(h.series[0].values, [3061, 3206]);
});

test('buildGlobalHistory: 공표가 없는 주는 null로 둔다', () => {
  const h = buildGlobalHistory(weekRows);
  assert.deepEqual(h.series[1].values, [1300, null]); // CCFI는 7/27 미공표
});

test('buildGlobalHistory: 관측이 1주뿐이면 추이가 아니다', () => {
  assert.equal(buildGlobalHistory([{ index_code: 'SCFI', week_date: '2026-07-27', value: 3206 }]), null);
  assert.equal(buildGlobalHistory([]), null);
});

const histRows = [
  { year: 2026, month: 6, series_name: '外航貨物輸送', basis: 'yen', value: 233.8 },
  { year: 2026, month: 6, series_name: '外航貨物輸送', basis: 'contract', value: 160.8 },
  { year: 2026, month: 5, series_name: '外航貨物輸送', basis: 'yen', value: 228.0 },
  { year: 2026, month: 5, series_name: '外航貨物輸送', basis: 'contract', value: 159.0 },
  { year: 2026, month: 6, series_name: '外航貨物輸送', basis: 'ex_tax', value: 233.8 },
  { year: 2026, month: 6, series_name: '港湾運送', basis: 'yen', value: 105.1 },  // 추이 대상 아님
];

test('buildSppiHistory: 두 기준을 각각 시간순으로 모은다', () => {
  const h = buildSppiHistory(histRows);
  assert.deepEqual(h.months, ['2026-05', '2026-06']);
  assert.equal(h.series.length, 1);
  assert.deepEqual(h.series[0].yen, [228.0, 233.8]);
  assert.deepEqual(h.series[0].contract, [159.0, 160.8]);
});

test('buildSppiHistory: 소비세 제외 계열은 넣지 않는다', () => {
  const h = buildSppiHistory(histRows);
  assert.ok(!JSON.stringify(h).includes('ex_tax'));
});

// history가 프롬프트로 새면 본문이 시계열 수치를 인용하기 시작한다.
test('slimFactsheet: history를 프롬프트에서 잘라낸다', () => {
  const { slimFactsheet } = require('../write/sections');
  const slim = slimFactsheet({
    periods: { sppi: '2026-06' },
    sppi: { series: [], signals: [], history: { months: ['2026-05'], series: [] } },
    global: { indices: [], history: { weeks: ['2026-07-27'], series: [] } },
  }, 'ocean');
  assert.ok(!('history' in slim.sppi));
  assert.ok(!('history' in slim.global));
});

// WCI が一度だけ火曜に公表された週があった。合集合を軸にすると、その日は他系列が
// 全て null になり、SCFI の線がそこで丸ごと切れる — データではなく軸の作り方の問題だった。
test('buildGlobalHistory: 한 계열만 요일이 어긋난 날은 축에 넣지 않는다', () => {
  const h = buildGlobalHistory([
    { index_code: 'SCFI', week_date: '2026-05-11', value: 2140 },
    { index_code: 'SCFI', week_date: '2026-05-18', value: 2218 },
    { index_code: 'SCFI', week_date: '2026-05-25', value: 2571 },
    { index_code: 'WCI', week_date: '2026-05-19', value: 2711 },   // 화요일 — 단독 공표
  ]);
  assert.ok(!h.weeks.includes('2026-05-19'));
  assert.deepEqual(h.series.find((s) => s.code === 'SCFI').values, [2140, 2218, 2571]);
});

// 欠航便数는 TEU가 아니라 便数다. 컬럼명이 blanked_teu / planned_teu지만
// Drewry의 "M blank sailings out of N planned sailings"의 M과 N이고 실체는 편수다.
// TEU로 쓰면 "58TEU가 결항"이라는 있을 수 없는 문장이 나간다.
test('buildSupplyFacts: 단위는 便数이고 범위는 East-West라고 밝힌다', () => {
  const fs = buildSupplyFacts([
    { week_start: '2026-07-17', blanked_teu: 39, planned_teu: null, blank_pct: 5 },
    { week_start: '2026-07-31', blanked_teu: 58, planned_teu: 723, blank_pct: 8 },
  ]);
  assert.equal(fs.unit, 'sailings');
  assert.match(fs.scope, /East-West/);
  assert.match(fs.scope, /日本発着に限った数字ではない/);

  // 가장 최근 주가 앞에 온다 — 입력 순서와 무관해야 한다.
  assert.equal(fs.asOf, '2026-07-31');
  assert.equal(fs.blankedSailings, 58);
  assert.equal(fs.plannedSailings, 723);
  assert.equal(fs.recent[0].week, '2026-07-31');
  assert.equal(fs.recent.length, 2);
});

test('buildSupplyFacts: 행이 없으면 null — 없는 축을 만들지 않는다', () => {
  assert.equal(buildSupplyFacts([]), null);
  assert.equal(buildSupplyFacts(null), null);
});

// 欠航便数는 East-West분을 갖게 됐지만 일본 발착은 여전히 없다. 갭은 그 차이만 남긴다.
test('KNOWN_GAPS: East-West를 가진 뒤에도 일본 발착 결손은 남는다', () => {
  const fs = buildFactsheet({
    sppi: { period: '2026-06' }, port: { period: '2026-05' },
    trade: { period: '2026-06' }, commodity: { period: '2026-06' },
  });
  assert.ok(fs.gaps.some((g) => /日本発着/.test(g)), '일본 발착 결손은 남아 있어야 한다');
  assert.ok(!fs.gaps.some((g) => /^日本発着ブランクセーリング/.test(g)),
    'East-West를 가졌으므로 "블랭크세일링 자체가 없다"는 문구는 지운다');
});

// 2026-06호 04-2가 「両者の系列間に親子関係があるかどうかは、このデータからは判断できない」이라고
// 썼다. 日銀이 공표하는 품목분류다. 아는 것을 모른다고 쓰면 신뢰가 깎인다.
// 모델에게 추론시키지 않고 계층을 데이터로 준다.
test('buildSppiFacts: 계열에 日銀 품목분류상의 부모를 붙인다', () => {
  const rows = [
    { series_name: '陸上貨物輸送', basis: 'yen', value: 111.6, category: 'land' },
    { series_name: '道路貨物輸送', basis: 'yen', value: 111.6, category: 'land' },
    { series_name: '鉄道貨物輸送', basis: 'yen', value: 107.0, category: 'land' },
    { series_name: '外航貨物輸送', basis: 'yen', value: 233.8, category: 'ocean' },
    { series_name: '運輸・郵便', basis: 'yen', value: 117.6, category: 'total' },
  ];
  const f = buildSppiFacts(rows, [], { year: 2026, month: 6 });
  const parentOf = (n) => f.series.find((s) => s.name === n).parent;

  assert.equal(parentOf('道路貨物輸送'), '陸上貨物輸送');
  assert.equal(parentOf('鉄道貨物輸送'), '陸上貨物輸送');
  assert.equal(parentOf('陸上貨物輸送'), '運輸・郵便');
  assert.equal(parentOf('外航貨物輸送'), '海上貨物輸送');
  // 최상위는 부모가 없다. null이면 본문에서 계층에 손대지 않는다.
  assert.equal(parentOf('運輸・郵便'), null);
  assert.match(f.hierarchyNote, /日本銀行の品目分類/);
});

// 값이 같다고 부모로 삼으면 안 된다. 표에 없는 계열은 null이어야 한다.
test('buildSppiFacts: 표에 없는 계열은 부모를 만들지 않는다', () => {
  const f = buildSppiFacts(
    [{ series_name: '未知の系列', basis: 'yen', value: 111.6, category: 'land' }],
    [], { year: 2026, month: 6 },
  );
  assert.equal(f.series[0].parent, null);
});

// 為替は外部の系列を足さずに出せる。日銀の定義で 円ベース = 契約通貨ベース × 為替 なので、
// 比がそのまま為替の動きになる。出典が日銀ひとつで完結し、壊れる依存が増えない。
test('fxContribution: 円ベース÷契約通貨ベースで為替寄与を出す', () => {
  // 外航貨物輸送 2026-06 실측. 233.8/160.8 = 1.454
  assert.equal(fxContribution(233.8, 160.8), 45.4);
  // ドル円 2020年平均106.8 → 2026-06 約155 が +45.1%. 独立に一致する。
  assert.ok(Math.abs(fxContribution(142.4, 98.1) - 45.2) < 0.1, '国際航空も同じ水準になる');
  assert.equal(fxContribution(233.8, null), null);
  assert.equal(fxContribution(233.8, 0), null);
});

// 積の関係なので引き算では合わない。ここがずれると交渉の数字が狂う。
test('fxContributionYoy: 差ではなく比で合成する', () => {
  // 円+52.8% / 契約+37.4% → 1.528/1.374 = 1.112
  assert.equal(fxContributionYoy(52.8, 37.4), 11.2);
  // 引き算なら 15.4 になってしまう
  assert.notEqual(fxContributionYoy(52.8, 37.4), 15.4);
  assert.equal(fxContributionYoy(52.8, null), null);
});

// 国内系列は円建て契約なので為替要因が無い。null のまま渡す。
test('buildSppiFacts: 契約通貨ベースが無い系列は為替寄与も null', () => {
  const f = buildSppiFacts(
    [{ series_name: '内航貨物輸送', basis: 'yen', value: 135, category: 'ocean' }],
    [], { year: 2026, month: 6 },
  );
  assert.equal(f.series[0].fxSinceBasePct, null);
  assert.equal(f.series[0].fxYoyPct, null);
});

// 為替は自前で数値化できるようになった。結損として並べ続けると本文が要らぬ留保を書く。
test('KNOWN_GAPS: 為替は結損ではなくなった', () => {
  const fs = buildFactsheet({
    sppi: { period: '2026-06' }, port: { period: '2026-05' },
    trade: { period: '2026-06' }, commodity: { period: '2026-06' },
  });
  assert.ok(!fs.gaps.some((g) => /為替/.test(g)), '為替を結損に残さない');
  assert.ok(fs.gaps.some((g) => /JPMAC/.test(g)), '航路別荷動きは本当に無い');
});

// 2026-06호가 「直近5週」이라고 썼는데 6/5·7/3·7/10·7/17·7/31 다섯 점이고
// 사이 네 주가 비어 있었다. 공표 주차가 연속이 아님을 데이터가 말해줘야 한다.
test('buildSupplyFacts: 공표 주차가 연속이 아님을 알린다', () => {
  const fs = buildSupplyFacts([
    { week_start: '2026-07-31', blanked_teu: 58, planned_teu: 723, blank_pct: 8 },
    { week_start: '2026-07-17', blanked_teu: 39, blank_pct: 5 },
    { week_start: '2026-07-10', blanked_teu: 46, blank_pct: 6 },
    { week_start: '2026-07-03', blanked_teu: 48, blank_pct: 7 },
    { week_start: '2026-06-05', blanked_teu: 39, blank_pct: 5.5 },
  ]);
  assert.equal(fs.recent.length, 5);
  // 5개 점이지만 실제로는 9주에 걸친다. 「直近5週」이라고 쓰면 안 된다.
  assert.equal(fs.recentSpanWeeks, 9);
  assert.match(fs.recentNote, /連続していない/);
  assert.match(fs.recentNote, /直近N週」とは書かず/);
});

// collectors/erai.ts가 index1520의 「최신월 변화」 열을 그대로 넣는다 — 前月比다.
// 라벨이 없어 2026-05호가 「前年同月比」라고 틀리게 썼다.
test('buildRailFacts: ERAI 변화율의 기준을 밝힌다', () => {
  const r = buildRailFacts([
    { index_code: 'ERAI', value: 3704, change_pct: 0.19, week_date: '2026-06-01' },
  ]);
  assert.equal(r.changeBasis, '前月比');
  assert.match(r.note, /前年同月比ではない/);
});

// 이 리포트에서 가장 큰 이야기다. 外航 +52.8% 대 国内航空 ▲3.2% — 이유는 계약통화다.
// signals에 넣어야 검수가 본문에서 다뤘는지 확인한다.
test('buildSppiFacts: 환율 노출 격차를 신호로 낸다', () => {
  const rows = [
    { series_name: '外航貨物輸送', basis: 'yen', value: 233.8, category: 'ocean' },
    { series_name: '外航貨物輸送', basis: 'contract', value: 160.8, category: 'ocean' },
    { series_name: '陸上貨物輸送', basis: 'yen', value: 111.6, category: 'land' },
  ];
  const prev = [
    { series_name: '外航貨物輸送', basis: 'yen', value: 153.0 },
    { series_name: '外航貨物輸送', basis: 'contract', value: 117.0 },
    { series_name: '陸上貨物輸送', basis: 'yen', value: 107.7 },
  ];
  const f = buildSppiFacts(rows, prev, { year: 2026, month: 6 });
  const gap = f.signals.find((s) => s.kind === 'fx_exposure_gap');
  assert.ok(gap, '환율 노출 격차 신호가 있어야 한다');
  assert.equal(gap.intlTop.name, '外航貨物輸送');
  assert.equal(gap.domesticLow.name, '陸上貨物輸送');
  assert.match(gap.note, /契約通貨/);
});

// 국제 계열이 없거나 국내 계열이 없으면 격차를 말할 수 없다. 신호를 만들지 않는다.
test('buildSppiFacts: 한쪽만 있으면 격차 신호를 만들지 않는다', () => {
  const f = buildSppiFacts(
    [{ series_name: '陸上貨物輸送', basis: 'yen', value: 111.6, category: 'land' }],
    [{ series_name: '陸上貨物輸送', basis: 'yen', value: 107.7 }], { year: 2026, month: 6 },
  );
  assert.equal(f.signals.find((s) => s.kind === 'fx_exposure_gap'), undefined);
});
