import test from 'node:test';
import assert from 'node:assert/strict';

import { parseTradePeriod, parseTradeCsv, dedupeTradeRows } from './trade_stats_jp';

// 한 회차가 지역별 CSV 9개로 쪼개져 있고, 'Grand Total'이 9개 파일 모두에 들어 있다.
// 그대로 upsert하면 같은 키가 9번이라 Postgres가 거부한다:
//   ON CONFLICT DO UPDATE command cannot affect row a second time
const row = (name: string, exp: number) => ({
  country_name: name, region: null, is_aggregate: true, year: 2026, month: 6,
  export_jpy: exp, import_jpy: null, yoy_export_pct: null, yoy_import_pct: null,
  unit: 'thousand_jpy', source: 's', source_url: 'u',
});

test('dedupeTradeRows: 같은 국가·연월은 하나만 남긴다', () => {
  const out = dedupeTradeRows([row('Grand Total', 100), row('Grand Total', 100), row('CHINA', 50)]);
  assert.equal(out.length, 2);
  assert.equal(out.filter((r) => r.country_name === 'Grand Total').length, 1);
});

test('dedupeTradeRows: 먼저 나온 행을 유지한다', () => {
  const out = dedupeTradeRows([row('Grand Total', 100), row('Grand Total', 999)]);
  assert.equal(out[0].export_jpy, 100);
});

test('dedupeTradeRows: 연월이 다르면 별개', () => {
  const may = { ...row('CHINA', 10), month: 5 };
  const out = dedupeTradeRows([row('CHINA', 20), may]);
  assert.equal(out.length, 2);
});

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
// 위치 규칙(파일당 앞 2열)만으로는 하위 집계를 놓친다.
// 실제로 ASIA NIES(2,564십억엔)·ASEAN·EU가 국가로 잡혀, 수출 상위 목록에서
// USA·CHINA와 나란히 비교됐다. 모집단이 달라 비교가 성립하지 않는다.
test('parseTradeCsv: 하위 지역 집계도 이름으로 판정한다', () => {
  const csv = [
    'Year & Month,Grand Total,,ASIA,,ASIA NIES,,ASEAN,,CHINA,',
    ',Exports,Imports,Exports,Imports,Exports,Imports,Exports,Imports,Exports,Imports',
    '2026 Jun.,100,100,60,60,25,25,16,16,18,18',
  ].join('\n');
  const rows = parseTradeCsv(csv);
  const agg = (n: string) => rows.find((r) => r.country_name === n)!.is_aggregate;
  assert.equal(agg('ASIA NIES'), true);
  assert.equal(agg('ASEAN'), true);
  assert.equal(agg('CHINA'), false);
});

test('parseTradeCsv: EU도 집계로 판정 — WESTERN EUROPE 파일의 하위 집계다', () => {
  const csv = [
    'Year & Month,Grand Total,,WESTERN EUROPE,,EU,,GERMANY,',
    ',Exports,Imports,Exports,Imports,Exports,Imports,Exports,Imports',
    '2026 Jun.,100,100,12,12,9,9,2,2',
  ].join('\n');
  const rows = parseTradeCsv(csv);
  assert.equal(rows.find((r) => r.country_name === 'EU')!.is_aggregate, true);
  assert.equal(rows.find((r) => r.country_name === 'GERMANY')!.is_aggregate, false);
});

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
