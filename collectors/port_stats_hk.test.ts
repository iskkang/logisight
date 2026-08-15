import test from 'node:test';
import assert from 'node:assert/strict';

import { parseCsv, markPreliminary, recentMonths, PRELIMINARY_MONTHS } from './port_stats_hk';

const HEADER =
  "Year,month,Kwai Tsing ( '000 TEUs),Other ( '000 TEUs),Total ( '000 TEUs)," +
  'Kwai Tsing (YoY %),Other (YoY %),Total (YoY %)';

function csv(...rows: string[]): string {
  return [HEADER, ...rows].join('\n');
}

// ★ 이 셋이 지시문이 미리 적어 둔 함정이다.

test("단위 환산: '000 TEUs 를 TEU 로 올린다", () => {
  const rows = parseCsv(csv('2026,Jun,781,280,1061,7.7,3.3,6.5'));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].teu, 1_061_000); // 1061 이 아니라 106만
});

test("연간 행(month='All')은 버린다", () => {
  const rows = parseCsv(csv('2025,All,15159,5881,21040,-14.5,-13.1,-14.1', '2026,Jun,781,280,1061,7.7,3.3,6.5'));
  assert.deepEqual(rows.map((r) => `${r.year}-${r.month}`), ['2026-6']);
});

test('최근 2개월만 잠정치로 표시한다', () => {
  const rows = markPreliminary(
    parseCsv(csv(
      '2026,Apr,775,260,1035,-11.8,1.2,-8.8',
      '2026,May,823,290,1113,3.7,4.5,3.9',
      '2026,Jun,781,280,1061,7.7,3.3,6.5',
    )),
  );
  assert.deepEqual(rows.map((r) => r.is_preliminary), [false, true, true]);
  assert.equal(PRELIMINARY_MONTHS, 2);
});

test('YoY% 를 그대로 담는다', () => {
  const rows = parseCsv(csv('2026,Jun,781,280,1061,7.7,3.3,6.5'));
  assert.equal(rows[0].yoy_pct, 6.5); // Total 의 YoY(8번째 열)
});

test('숫자로 못 읽는 행은 0으로 채우지 않고 버린다', () => {
  const rows = parseCsv(csv('2026,May,-,-,-,-,-,-', '2026,Jun,781,280,1061,7.7,3.3,6.5'));
  assert.deepEqual(rows.map((r) => r.month), [6]);
});

test('연월 순서가 뒤섞여 있어도 최근 n개월을 정확히 고른다', () => {
  const rows = recentMonths(
    parseCsv(csv(
      '2026,Jun,781,280,1061,7.7,3.3,6.5',
      '2025,Dec,700,200,900,1,1,1',
      '2026,Jan,710,210,920,1,1,1',
    )),
    2,
  );
  assert.deepEqual(rows.map((r) => `${r.year}-${r.month}`), ['2026-1', '2026-6']);
});

test('country·port_code 는 HK / HK_ALL 로 고정', () => {
  const rows = parseCsv(csv('2026,Jun,781,280,1061,7.7,3.3,6.5'));
  assert.equal(rows[0].country, 'HK');
  assert.equal(rows[0].port_code, 'HK_ALL');
  assert.equal(rows[0].export_teu, null);
  assert.equal(rows[0].import_teu, null);
});
