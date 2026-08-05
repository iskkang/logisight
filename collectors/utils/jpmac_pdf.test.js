'use strict';
const test = require('node:test');
const assert = require('node:assert');

const {
  parseHeader, parseTable, parseProseTotal, crossCheck, parseNorthAmerica, parseEurope,
} = require('./jpmac_pdf');

// 2026년 6월 북미 왕항 개요 PDF에서 실제로 뽑힌 텍스트.
// 숫자가 구분자 없이 붙어 나오는 것이 이 파서의 존재 이유다.
const NA_TEXT = [
  '日本・アジア/米国間コンテナ貨物の荷動き動向について',
  '2026年6月[往航]速報値',
  '（公財）日本海事センター・企画研究部',
  '2026/7/28',
  'I.往航（アジア18ヶ国・地域→米国）の荷動き',
  '1. 2026年6月のアジア（18ヶ国・地域）から米国へのコンテナ荷動き量は、前年比14%増の191.6',
  '万TEU。1-6月の累計では、前年同期比0.3%増の1078.5万TEU。',
  '表1 2026年6月：積国・地域別荷動き',
  '国.地域         荷動量 前年比 シェア     累計 前年同期比',
  '18ヶ国・地域 合計1,916,30714.0100.010,784,7550.3',
  '日本53,701   -3.2    2.8321,930-3.4',
  '韓国108,0210.95.6637,425-6.5',
  '中国954,767   25.5   49.8   5,223,968-3.7',
  'マカオ2   -24.5    0.012-90.2',
  '出所：PIERS',
].join('\n');

// 유럽은 지역별까지만 나온다. 「186.7万」과 「TEU」 사이에서 줄이 끊긴다.
const EU_TEXT = [
  '日本・アジア/欧州間コンテナ貨物の荷動き動向について',
  '2026年5月[往航/復航]速報値',
  '2026/7/28',
  '1. 2026年5月のアジア（16ヶ国・地域）から欧州へのコンテナ荷動き量（積地出帆）は、前年比3.1%増の186.7万',
  'TEU。1-5月の累計では、前年同期比11.7%増の888.4万TEU。',
  '表1アジア(積)地域別荷動き',
  '地域荷動量 前年比 シェア 今年の累計 前年同期比',
  'アジア 合計1,866,9843.1100.08,884,02311.7',
  '北東アジア 計144,086   -9.8    7.7    724,251-1.8',
  '中華地域 計1,475,3753.479.07,007,86113.3',
  '出所：CTS社',
].join('\n');

test('parseHeader: 기준월·방향·발표일', () => {
  const h = parseHeader(NA_TEXT);
  assert.equal(h.year, 2026);
  assert.equal(h.month, 6);
  assert.deepEqual(h.directions, ['往航']);
  assert.equal(h.publishedAt, '2026-07-28');
});

test('parseHeader: 왕항·복항이 함께 나오는 경우', () => {
  assert.deepEqual(parseHeader(EU_TEXT).directions, ['往航', '復航']);
});

// 표의 숫자에 구분자가 없다. 쉼표가 3자리씩 끊는다는 성질로 경계를 잡는다.
test('parseTable: 붙어 나온 숫자를 다섯 값으로 가른다', () => {
  const rows = parseTable(NA_TEXT, /^表1\s*\d{4}年\d{1,2}月/);
  const jp = rows.find((r) => r.name === '日本');
  assert.deepEqual(jp, {
    name: '日本', teu: 53701, yoyPct: -3.2, sharePct: 2.8, cumTeu: 321930, cumYoyPct: -3.4,
  });
});

// 이름에 숫자가 들어간다. 이름을 게으르게 잡지 않으면 「1」에서 끊긴다.
test('parseTable: 「18ヶ国・地域 合計」처럼 이름에 숫자가 있어도 된다', () => {
  const rows = parseTable(NA_TEXT, /^表1\s*\d{4}年\d{1,2}月/);
  assert.equal(rows[0].name, '18ヶ国・地域 合計');
  assert.equal(rows[0].teu, 1916307);
  assert.equal(rows[0].sharePct, 100.0);
  assert.equal(rows[0].cumTeu, 10784755);
});

// 쉼표가 없는 작은 수도 있다. 「マカオ2 -24.5 0.012-90.2」
test('parseTable: 쉼표 없는 수도 가른다', () => {
  const rows = parseTable(NA_TEXT, /^表1\s*\d{4}年\d{1,2}月/);
  const macao = rows.find((r) => r.name === 'マカオ');
  assert.equal(macao.teu, 2);
  assert.equal(macao.cumTeu, 12);
  assert.equal(macao.cumYoyPct, -90.2);
});

test('parseTable: 出所를 만나면 멈춘다', () => {
  const rows = parseTable(NA_TEXT, /^表1\s*\d{4}年\d{1,2}月/);
  assert.equal(rows.length, 5);
});

test('parseTable: 표가 없으면 빈 배열', () => {
  assert.deepEqual(parseTable('내용 없음', /^表1/), []);
});

// PDF는 단위 중간에서도 줄이 끊긴다. 공백을 지우고 봐야 한다.
test('parseProseTotal: 「万」과 「TEU」 사이 줄바꿈을 넘긴다', () => {
  assert.deepEqual(parseProseTotal(EU_TEXT), { yoyPct: 3.1, manTeu: 186.7 });
});

test('parseProseTotal: 減이면 음수', () => {
  const r = parseProseTotal('荷動き量は、前年比5.5%減の120.0万TEU。');
  assert.equal(r.yoyPct, -5.5);
});

// 표만 믿으면 형식이 바뀌었을 때 조용히 틀린 수가 나간다(Drewry가 3주간 그랬다).
// 두 경로로 읽어 어긋나면 그 회차를 버린다.
test('crossCheck: 표와 본문이 맞으면 통과', () => {
  assert.equal(crossCheck(1916307, { manTeu: 191.6 }).ok, true);
});

test('crossCheck: 어긋나면 이유를 남긴다', () => {
  const r = crossCheck(1916307, { manTeu: 150.0 });
  assert.equal(r.ok, false);
  assert.match(r.reason, /191\.63万TEU vs 本?文?\s*150万TEU|191\.63/);
});

test('crossCheck: 대조할 값이 없으면 통과시키지 않는다', () => {
  assert.equal(crossCheck(1916307, null).ok, false);
  assert.equal(crossCheck(NaN, { manTeu: 191.6 }).ok, false);
});

test('parseNorthAmerica: 헤더·행·대조를 함께 돌려준다', () => {
  const r = parseNorthAmerica(NA_TEXT);
  assert.equal(r.header.month, 6);
  assert.equal(r.check.ok, true);
  assert.ok(r.rows.some((x) => x.name === '日本'));
});

// 유럽은 지역별까지다. 일본 단독 수치는 여기서 못 얻는다.
test('parseEurope: 지역 행만 나온다 — 일본은 없다', () => {
  const r = parseEurope(EU_TEXT);
  assert.equal(r.check.ok, true);
  assert.equal(r.rows[0].name, 'アジア 合計');
  assert.ok(!r.rows.some((x) => x.name === '日本'));
});

test('헤더가 없으면 null — 엉뚱한 PDF를 받았을 때', () => {
  assert.equal(parseNorthAmerica('관계없는 문서'), null);
});
