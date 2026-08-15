import test from 'node:test';
import assert from 'node:assert/strict';

import { parsePage, buildRows, defaultRange, EXPECTED_AREAS } from './port_stats_kr';

function item(useYm: string, e: number, t: number): string {
  return `<item><useYm>${useYm}</useYm><areaCd>01</areaCd><areaNm>일본 지역</areaNm>` +
    `<eContnTeuTotal>${e}</eContnTeuTotal><tContnTeuTotal>${t}</tContnTeuTotal></item>`;
}

function fullMonth(ym: string, per = 100): string {
  return Array.from({ length: EXPECTED_AREAS }, () => item(ym, per, per)).join('');
}

test('parsePage: item 에서 useYm·e·t 를 뽑는다', () => {
  const got = parsePage(`<response><body><items>${item('202606', 1.5, 2.5)}</items></body></response>`);
  assert.deepEqual(got, [{ useYm: '202606', eContnTeuTotal: 1.5, tContnTeuTotal: 2.5 }]);
});

test('parsePage: 숫자로 못 읽는 값은 0으로 채우지 않고 버린다', () => {
  const xml = `<items>${item('202606', 10, 20)}` +
    `<item><useYm>202607</useYm><eContnTeuTotal>-</eContnTeuTotal><tContnTeuTotal>5</tContnTeuTotal></item></items>`;
  assert.deepEqual(parsePage(xml).map((x) => x.useYm), ['202606']);
});

test('buildRows: e + t 를 합친다 (수출입이 아니라 양하+적하 = 총 물동량)', () => {
  const { rows } = buildRows(parsePage(fullMonth('202606', 100)));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].teu, EXPECTED_AREAS * 200);
  assert.equal(rows[0].port_code, 'KR_ALL');
  assert.equal(rows[0].country, 'KR');
  assert.equal(rows[0].year, 2026);
  assert.equal(rows[0].month, 6);
});

test('buildRows: e/t 는 수출입이 아니므로 export_teu·import_teu 를 채우지 않는다', () => {
  const { rows } = buildRows(parsePage(fullMonth('202606')));
  assert.equal(rows[0].export_teu, null);
  assert.equal(rows[0].import_teu, null);
});

// ★ 이 테스트가 이 파일의 존재 이유다.
// numOfRows 를 키워도 API 가 50건에서 자르기 때문에, 페이지를 안 넘기면 마지막 달이
// "지역 2개짜리 미완월"로 보인다. 그걸 합계로 적재하면 물동량이 반토막 난다.
test('buildRows: 지역이 덜 찬 달은 버린다 (잘린 페이지를 실적으로 적재하지 않는다)', () => {
  const xml = fullMonth('202605') + item('202606', 100, 100) + item('202606', 100, 100);
  const { rows, partial } = buildRows(parsePage(xml));
  assert.deepEqual(rows.map((r) => `${r.year}-${r.month}`), ['2026-5']);
  assert.deepEqual(partial, [`202606(지역 2/${EXPECTED_AREAS})`]);
});

test('buildRows: 여러 달이 다 차 있으면 연월 순으로 나온다', () => {
  const { rows, partial } = buildRows(parsePage(fullMonth('202512') + fullMonth('202601')));
  assert.deepEqual(rows.map((r) => `${r.year}-${r.month}`), ['2025-12', '2026-1']);
  assert.deepEqual(partial, []);
});

test('defaultRange: 최근 36개월 (양끝 포함)', () => {
  assert.deepEqual(defaultRange(new Date('2026-08-15T00:00:00Z')), { sym: '202309', eym: '202608' });
});
