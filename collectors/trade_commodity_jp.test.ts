import test from 'node:test';
import assert from 'node:assert/strict';

import {
  monthFromCat02,
  stripCodePrefix,
  buildCommodityRows,
  dropUnreportedMonths,
  TOP_COMMODITIES,
} from './trade_commodity_jp';

// 표가 연 단위라 아직 공표되지 않은 달의 셀이 0으로 채워져 반환된다.
// 실측: 2026년 표에서 1~6월은 월 9~11조엔, 7~12월은 0이 아닌 행이 한 건도 없다.
// 그대로 적재하면 사이트에 "12월 대중 수출 0엔"이 찍힌다.
const cell = (month: number, value: number) => ({
  direction: 'export', commodity_code: '00000000', commodity_name: '食料品',
  country_code: '50103', country_name: '大韓民国',
  year: 2026, month, value_jpy: value, unit: 'thousand_jpy', source: 's', source_url: 'u',
});

test('dropUnreportedMonths: 전부 0인 달은 통째로 버린다', () => {
  const kept = dropUnreportedMonths([cell(6, 100), cell(6, 0), cell(7, 0), cell(7, 0)]);
  assert.deepEqual([...new Set(kept.map((r) => r.month))], [6]);
});

test('dropUnreportedMonths: 공표된 달의 0은 남긴다 — 실제 거래 0일 수 있다', () => {
  const kept = dropUnreportedMonths([cell(6, 100), cell(6, 0)]);
  assert.equal(kept.length, 2);
});

test('dropUnreportedMonths: 방향이 다르면 따로 판단한다', () => {
  const imp = { ...cell(7, 500), direction: 'import' };
  const kept = dropUnreportedMonths([cell(7, 0), imp]);
  assert.equal(kept.length, 1);
  assert.equal(kept[0].direction, 'import');
});

test('dropUnreportedMonths: 빈 입력', () => {
  assert.deepEqual(dropUnreportedMonths([]), []);
});

// cat02는 월과 수량/금액이 한 코드에 섞여 있다. 金額만 쓰는 이유는
// 数量의 단위가 품목마다 달라(kg·리터·개) 한 컬럼에 섞으면 합산이 무의미해지기 때문이다.
test('monthFromCat02: 금액 코드에서 월을 뽑는다 (120 + 월×20)', () => {
  assert.equal(monthFromCat02('140'), 1);
  assert.equal(monthFromCat02('240'), 6);
  assert.equal(monthFromCat02('360'), 12);
});

test('monthFromCat02: 수량·합계·단위 코드는 null', () => {
  assert.equal(monthFromCat02('130'), null); // 1月_数量
  assert.equal(monthFromCat02('110'), null); // 合計_数量
  assert.equal(monthFromCat02('120'), null); // 合計_金額
  assert.equal(monthFromCat02('100'), null); // 単位
  assert.equal(monthFromCat02(''), null);
});

test('stripCodePrefix: 명칭 앞 코드 접두어를 걷어낸다', () => {
  assert.equal(stripCodePrefix('0_食料品及び動物'), '食料品及び動物');
  assert.equal(stripCodePrefix('103_大韓民国'), '大韓民国');
  assert.equal(stripCodePrefix('7_機械類及び輸送用機器'), '機械類及び輸送用機器');
});

test('stripCodePrefix: 접두어가 없으면 그대로', () => {
  assert.equal(stripCodePrefix('総額'), '総額');
  assert.equal(stripCodePrefix(''), '');
});

const NAMES = {
  commodity: { '00000000': '0_食料品及び動物', '70000000': '7_機械類及び輸送用機器' },
  country: { '50103': '103_大韓民国', '50105': '105_中華人民共和国' },
};

test('buildCommodityRows: 품목·국가·월을 풀어 행으로 만든다', () => {
  const rows = buildCommodityRows(
    [
      { '@cat01': '00000000', '@cat02': '140', '@area': '50103', $: '7004145' },
      { '@cat01': '70000000', '@cat02': '240', '@area': '50105', $: '123456' },
    ],
    { year: 2026, direction: 'export', ...NAMES },
  );
  assert.equal(rows.length, 2);
  const food = rows.find((r) => r.commodity_code === '00000000')!;
  assert.equal(food.commodity_name, '食料品及び動物');
  assert.equal(food.country_name, '大韓民国');
  assert.equal(food.year, 2026);
  assert.equal(food.month, 1);
  assert.equal(food.value_jpy, 7004145);
  assert.equal(food.direction, 'export');
});

test('buildCommodityRows: 수량 코드는 걸러낸다', () => {
  const rows = buildCommodityRows(
    [{ '@cat01': '00000000', '@cat02': '130', '@area': '50103', $: '999' }],
    { year: 2026, direction: 'export', ...NAMES },
  );
  assert.deepEqual(rows, []);
});

test('buildCommodityRows: 이름을 모르는 코드는 버린다 — 정체불명 행을 넣지 않는다', () => {
  const rows = buildCommodityRows(
    [{ '@cat01': '99999999', '@cat02': '140', '@area': '50103', $: '100' }],
    { year: 2026, direction: 'export', ...NAMES },
  );
  assert.deepEqual(rows, []);
});

test('buildCommodityRows: 비공표 기호는 제외', () => {
  const rows = buildCommodityRows(
    [{ '@cat01': '00000000', '@cat02': '140', '@area': '50103', $: '-' }],
    { year: 2026, direction: 'export', ...NAMES },
  );
  assert.deepEqual(rows, []);
});

test('TOP_COMMODITIES: 최상위 10개 품목 코드', () => {
  assert.equal(TOP_COMMODITIES.length, 10);
  assert.ok(TOP_COMMODITIES.includes('70000000')); // 機械類及び輸送用機器
  assert.ok(TOP_COMMODITIES.every((c) => /^\d0000000$/.test(c)));
});
