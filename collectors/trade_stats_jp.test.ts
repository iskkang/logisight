import test from 'node:test';
import assert from 'node:assert/strict';

import { parseTradePeriod, parseTradeCsv } from './trade_stats_jp';

test('parseTradePeriod: 월차 라벨', () => {
  assert.deepEqual(parseTradePeriod('2026 Jun.'), { year: 2026, month: 6 });
  assert.deepEqual(parseTradePeriod('2026 May.'), { year: 2026, month: 5 });
  assert.deepEqual(parseTradePeriod('2025 Dec.'), { year: 2025, month: 12 });
});

// 같은 열에 연차·회계연도·분기·비율 행이 섞여 있다. 이걸 월차로 오인하면
// 분기 합계가 한 달치로 적재돼 수치가 3배로 부풀려진다.
test('parseTradePeriod: 월차가 아닌 라벨은 전부 null', () => {
  assert.equal(parseTradePeriod('2023'), null);
  assert.equal(parseTradePeriod('2023 (FY)'), null);
  assert.equal(parseTradePeriod('2025 Apr.-Jun.'), null); // 분기
  assert.equal(parseTradePeriod('(Ratio to PY)'), null);
  assert.equal(parseTradePeriod('(Ratio to SM)'), null);
  assert.equal(parseTradePeriod(''), null);
});

const CSV = [
  'Year & Month,Grand Total,,ASIA,,R KOREA,,CHINA,',
  ',Exports,Imports,Exports,Imports,Exports,Imports,Exports,Imports',
  '2025,110400454682,113330098822,59899927512,55753962538,6958172331,4505405384,18778014976,26699859835',
  '(Ratio to PY),103.1,100.5,105.3,103.4,99.0,94.6,99.6,105.5',
  '2025 Apr.-Jun.,27000000000,28000000000,14000000000,13000000000,1700000000,1100000000,4600000000,6600000000',
  '2026 May.,9000000000,9500000000,4900000000,4600000000,570000000,370000000,1500000000,2200000000',
  '2026 Jun.,9200000000,9600000000,5000000000,4700000000,580000000,380000000,1560000000,2250000000',
  '(Ratio to SM),119.3,125.4,122.6,129.4,123.5,132.1,117.6,127.9',
].join('\n');

test('parseTradeCsv: 월차 행만 뽑는다 — 연차·분기·비율은 제외', () => {
  const rows = parseTradeCsv(CSV);
  const periods = [...new Set(rows.map((r) => `${r.year}-${r.month}`))].sort();
  assert.deepEqual(periods, ['2026-5', '2026-6']);
});

test('parseTradeCsv: 국가별 수출·수입을 짝지어 담는다', () => {
  const rows = parseTradeCsv(CSV);
  const china = rows.find((r) => r.country_name === 'CHINA' && r.month === 6);
  assert.ok(china);
  assert.equal(china!.export_jpy, 1560000000);
  assert.equal(china!.import_jpy, 2250000000);
});

// Grand Total과 지역 합계를 국가와 같은 취급하면 합산 시 이중계상된다.
test('parseTradeCsv: 총계·지역합계를 집계 행으로 표시하고 국가에 지역을 붙인다', () => {
  const rows = parseTradeCsv(CSV);
  const world = rows.find((r) => r.country_name === 'Grand Total' && r.month === 6);
  assert.equal(world!.is_aggregate, true);
  assert.equal(world!.region, null);

  const asia = rows.find((r) => r.country_name === 'ASIA' && r.month === 6);
  assert.equal(asia!.is_aggregate, true);
  assert.equal(asia!.region, 'ASIA');

  const korea = rows.find((r) => r.country_name === 'R KOREA' && r.month === 6);
  assert.equal(korea!.is_aggregate, false);
  assert.equal(korea!.region, 'ASIA');
});

// 前年同月比가 또 지수 표기다(119.3 = +19.3%). 그대로 저장하면 100%p 틀린다.
test('parseTradeCsv: 전년동월비 지수를 증감률로 바꿔 최신 월에만 붙인다', () => {
  const rows = parseTradeCsv(CSV);
  const june = rows.find((r) => r.country_name === 'CHINA' && r.month === 6);
  assert.ok(Math.abs(june!.yoy_export_pct! - 17.6) < 0.001);
  assert.ok(Math.abs(june!.yoy_import_pct! - 27.9) < 0.001);
  // 직전 달에는 비율이 공표되지 않는다 — 임의로 채우지 않는다.
  const may = rows.find((r) => r.country_name === 'CHINA' && r.month === 5);
  assert.equal(may!.yoy_export_pct, null);
});

test('parseTradeCsv: 숫자가 아닌 값(- 등 비공표)은 null', () => {
  const csv = [
    'Year & Month,Grand Total,,ASIA,',
    ',Exports,Imports,Exports,Imports',
    '2026 Jun.,9200000000,9600000000,-,-',
  ].join('\n');
  const rows = parseTradeCsv(csv);
  const asia = rows.find((r) => r.country_name === 'ASIA');
  assert.equal(asia!.export_jpy, null);
  assert.equal(asia!.import_jpy, null);
});

test('parseTradeCsv: 헤더가 비면 빈 배열 — 형식 변경 시 조용히 쓰레기를 넣지 않는다', () => {
  assert.deepEqual(parseTradeCsv(''), []);
  assert.deepEqual(parseTradeCsv('Year & Month\n'), []);
});
