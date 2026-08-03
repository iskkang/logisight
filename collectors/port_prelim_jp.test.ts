import test from 'node:test';
import assert from 'node:assert/strict';

import { parsePeriodFromTitle, parsePrelimSheet, PRELIM_PORTS } from './port_prelim_jp';

test('parsePeriodFromTitle: 카탈로그 제목에서 연·월', () => {
  assert.deepEqual(parsePeriodFromTitle('港湾統計（速報）_月次_2026年5月'), { year: 2026, month: 5 });
  assert.deepEqual(parsePeriodFromTitle('港湾統計（速報）_月次_2020年11月'), { year: 2020, month: 11 });
});

test('parsePeriodFromTitle: 연월이 없으면 null', () => {
  assert.equal(parsePeriodFromTitle('港湾統計（速報）'), null);
  assert.equal(parsePeriodFromTitle(''), null);
});

// 실제 XLS 구조: 3행이 헤더, 4행부터 항만. 열은 [항만, 합계TEU, 전년비, 輸出TEU, 전년비, 輸入TEU, 전년비]
const SHEET: (string | number)[][] = [
  ['合計', '合計', '輸出', '輸出', '輸入', '輸入'],
  ['コンテナ個数', '前年同月比', 'コンテナ個数', '前年同月比', 'コンテナ個数', '前年同月比'],
  ['TEU', '％', 'TEU', '％', 'TEU', '％'],
  ['合計', 1177717, 100.128, 562219, 97.123, 615498, 103.039],
  ['東京港', 367332, 100.058, 160049, 97.108, 207283, 102.46],
  ['神戸港', 174728, 100.712, 89454, 97.247, 85274, 104.622],
];

test('parsePrelimSheet: 항만별 합계·수출·수입을 뽑는다', () => {
  const rows = parsePrelimSheet(SHEET, 2026, 5);
  const tokyo = rows.find((r) => r.port_code === 'JPTYO');
  assert.ok(tokyo);
  assert.equal(tokyo!.teu, 367332);
  assert.equal(tokyo!.export_teu, 160049);
  assert.equal(tokyo!.import_teu, 207283);
  assert.equal(tokyo!.year, 2026);
  assert.equal(tokyo!.month, 5);
  assert.equal(tokyo!.country, 'JP');
  assert.equal(tokyo!.is_preliminary, true);
});

// 前年同月比는 변화율이 아니라 지수(100.128 = +0.128%)로 들어온다. 그대로 쓰면 100%p 틀린다.
test('parsePrelimSheet: 전년동월비 지수를 증감률로 바꾼다', () => {
  const rows = parsePrelimSheet(SHEET, 2026, 5);
  const tokyo = rows.find((r) => r.port_code === 'JPTYO');
  assert.ok(Math.abs(tokyo!.yoy_pct! - 0.058) < 0.001);
  const kobe = rows.find((r) => r.port_code === 'JPUKB');
  assert.ok(Math.abs(kobe!.yoy_pct! - 0.712) < 0.001);
});

// 이 합계는 主要6港 합계지 全国이 아니다. 확보(確報)의 全国(JP_ALL)과 섞으면 수치가 어긋난다.
test('parsePrelimSheet: 합계는 主要6港 코드로 구분한다', () => {
  const rows = parsePrelimSheet(SHEET, 2026, 5);
  const total = rows.find((r) => r.teu === 1177717);
  assert.equal(total!.port_code, 'JP_MAJOR6');
  assert.ok(!rows.some((r) => r.port_code === 'JP_ALL'));
});

test('parsePrelimSheet: 헤더 행과 모르는 항만은 건너뛴다', () => {
  const rows = parsePrelimSheet(SHEET, 2026, 5);
  assert.equal(rows.length, 3); // 合計 + 東京 + 神戸
});

test('parsePrelimSheet: 숫자가 아닌 값이 든 행은 제외', () => {
  const rows = parsePrelimSheet([...SHEET, ['横浜港', '-', '-', '-', '-', '-', '-']], 2026, 5);
  assert.ok(!rows.some((r) => r.port_code === 'JPYOK'));
});

test('PRELIM_PORTS: 主要6港이 모두 매핑돼 있다', () => {
  for (const name of ['東京港', '川崎港', '横浜港', '名古屋港', '大阪港', '神戸港']) {
    assert.ok(PRELIM_PORTS[name], `${name} 매핑 누락`);
  }
});
