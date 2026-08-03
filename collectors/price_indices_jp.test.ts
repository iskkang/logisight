import test from 'node:test';
import assert from 'node:assert/strict';

import { parseSeriesCode, parsePeriod, buildIndexRows, TARGET_SERIES } from './price_indices_jp';

// 계열 코드는 PRCS20_ + 기준구분(2자리) + 계열 일련번호(8자리) 구조다.
// 같은 지표라도 엔 베이스(52)·계약통화 베이스(51)·소비세 제외(42)가 따로 나온다.
test('parseSeriesCode: 접두어로 기준을 구분한다', () => {
  assert.deepEqual(parseSeriesCode('PRCS20_5200730001'), { basis: 'yen', suffix: '00730001' });
  assert.deepEqual(parseSeriesCode('PRCS20_5100730001'), { basis: 'contract', suffix: '00730001' });
  assert.deepEqual(parseSeriesCode('PRCS20_4200730001'), { basis: 'ex_tax', suffix: '00730001' });
});

test('parseSeriesCode: 모르는 접두어·형식은 null', () => {
  assert.equal(parseSeriesCode('PRCS20_9900730001'), null);
  assert.equal(parseSeriesCode('PRCS20_52B3750001'), null); // 참고 조합계열
  assert.equal(parseSeriesCode(''), null);
});

test('parsePeriod: YYYYMM → 연·월', () => {
  assert.deepEqual(parsePeriod('202606'), { year: 2026, month: 6 });
  assert.deepEqual(parsePeriod('202001'), { year: 2020, month: 1 });
});

test('parsePeriod: 형식이 다르면 null', () => {
  assert.equal(parsePeriod('2026'), null);
  assert.equal(parsePeriod('202613'), null); // 13월
  assert.equal(parsePeriod(''), null);
});

const CSV = [
  ',,,202605,202606',
  'PRCS20_5200730001,"企業向けサービス価格指数 2020年基準","小類別/__外航貨物輸送",230.1,233.8',
  'PRCS20_5100730001,"企業向けサービス価格指数 2020年基準/〔参考系列〕契約通貨ベース","小類別/__外航貨物輸送",159.0,160.8',
  'PRCS20_5200830001,"企業向けサービス価格指数 2020年基準","小類別/__国際航空貨物輸送",140.0,142.4',
  'PRCS20_5200250005,"企業向けサービス価格指数 2020年基準","品目/___海上・運送保険",173.0,173.4',
].join('\n');

test('buildIndexRows: 대상 계열만 기준별로 뽑는다', () => {
  const rows = buildIndexRows(CSV);
  // 외항화물 2계열 × 2개월 + 국제항공화물 1계열 × 2개월 = 6행. 해상보험은 대상 밖.
  assert.equal(rows.length, 6);
  assert.ok(!rows.some((r) => r.series_name.includes('保険')));
});

test('buildIndexRows: 엔 베이스와 계약통화 베이스가 각각 저장된다', () => {
  const rows = buildIndexRows(CSV);
  const june = rows.filter((r) => r.year === 2026 && r.month === 6 && r.series_name === '外航貨物輸送');
  assert.equal(june.length, 2);
  assert.equal(june.find((r) => r.basis === 'yen')?.value, 233.8);
  assert.equal(june.find((r) => r.basis === 'contract')?.value, 160.8);
});

test('buildIndexRows: 카테고리가 붙는다 — 사이트에서 해상·항공을 나눠 보여준다', () => {
  const rows = buildIndexRows(CSV);
  assert.equal(rows.find((r) => r.series_name === '外航貨物輸送')?.category, 'ocean');
  assert.equal(rows.find((r) => r.series_name === '国際航空貨物輸送')?.category, 'air');
});

test('buildIndexRows: 값이 비어 있는 달은 건너뛴다', () => {
  const csv = [
    ',,,202605,202606',
    'PRCS20_5200730001,"企業向けサービス価格指数 2020年基準","小類別/__外航貨物輸送",230.1,',
  ].join('\n');
  const rows = buildIndexRows(csv);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].month, 5);
});

test('buildIndexRows: 계열명에서 분류 접두어와 밑줄을 걷어낸다', () => {
  const rows = buildIndexRows(CSV);
  assert.ok(rows.every((r) => !r.series_name.includes('_')));
  assert.ok(rows.every((r) => !r.series_name.includes('/')));
});

test('TARGET_SERIES: 외항·국제항공 화물이 포함돼 있다', () => {
  assert.ok(TARGET_SERIES['00730001']);
  assert.equal(TARGET_SERIES['00730001'].category, 'ocean');
  assert.ok(TARGET_SERIES['00830001']);
  assert.equal(TARGET_SERIES['00830001'].category, 'air');
});
