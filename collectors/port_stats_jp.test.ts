import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseEstatTime,
  buildPortRows,
  isPlausibleTeu,
  filterImplausible,
  JP_PORTS,
} from './port_stats_jp';

const row = (port: string, year: number, month: number, teu: number) => ({
  port_code: port, country: 'JP', year, month, teu, source: 's', source_url: 'u',
});

test('filterImplausible: 항만별로 시간순 이력을 쌓아 급락만 걸러낸다', () => {
  const rows = [
    row('JPTYO', 2025, 4, 300000),
    row('JPTYO', 2025, 5, 310000),
    row('JPTYO', 2025, 6, 295000),
    row('JPTYO', 2025, 7, 305000),
    row('JPTYO', 2025, 8, 3688), // 미집계로 보이는 값
    row('JPYOK', 2025, 8, 200000), // 다른 항만은 영향받지 않는다
  ];
  const { kept, dropped } = filterImplausible(rows);
  assert.equal(dropped.length, 1);
  assert.equal(dropped[0].month, 8);
  assert.equal(dropped[0].port_code, 'JPTYO');
  assert.equal(kept.length, 5);
  assert.ok(kept.some((r) => r.port_code === 'JPYOK'));
});

test('filterImplausible: 입력 순서가 뒤섞여도 시간순으로 판단한다', () => {
  const rows = [
    row('JPTYO', 2025, 8, 3688),
    row('JPTYO', 2025, 5, 310000),
    row('JPTYO', 2025, 7, 305000),
    row('JPTYO', 2025, 4, 300000),
    row('JPTYO', 2025, 6, 295000),
  ];
  const { dropped } = filterImplausible(rows);
  assert.equal(dropped.length, 1);
  assert.equal(dropped[0].month, 8);
});

// e-Stat 월차 시간축 코드는 YYYY + '00' + MM + MM 형태다 (2025年10月 = '2025001010').
test('parseEstatTime: 월차 코드 → 연·월', () => {
  assert.deepEqual(parseEstatTime('2025001010'), { year: 2025, month: 10 });
  assert.deepEqual(parseEstatTime('2010000101'), { year: 2010, month: 1 });
});

test('parseEstatTime: 형식이 다르면 null — 연차 코드가 섞여 들어와도 죽지 않는다', () => {
  assert.equal(parseEstatTime('2025'), null);
  assert.equal(parseEstatTime(''), null);
  assert.equal(parseEstatTime('20250000ZZ'), null);
});

test('buildPortRows: 같은 항만·같은 달의 輸出(110)·輸入(120)을 합산', () => {
  const rows = buildPortRows([
    { '@cat01': '110', '@cat02': '13001', '@time': '2025000707', $: '154408' },
    { '@cat01': '120', '@cat02': '13001', '@time': '2025000707', $: '160000' },
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].port_code, 'JPTYO');
  assert.equal(rows[0].teu, 314408);
  assert.equal(rows[0].year, 2025);
  assert.equal(rows[0].month, 7);
  assert.equal(rows[0].country, 'JP');
});

test('buildPortRows: 매핑에 없는 항만 코드는 제외', () => {
  const rows = buildPortRows([
    { '@cat01': '110', '@cat02': '99999', '@time': '2025000707', $: '100' },
  ]);
  assert.deepEqual(rows, []);
});

test('buildPortRows: 移出(130)·移入(140) 내항 물동량은 제외 — 외국무역만 집계', () => {
  const rows = buildPortRows([
    { '@cat01': '110', '@cat02': '13001', '@time': '2025000707', $: '100' },
    { '@cat01': '130', '@cat02': '13001', '@time': '2025000707', $: '900' },
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].teu, 100);
});

test('buildPortRows: 숫자가 아닌 값(-, X 등 비공표 기호)은 무시', () => {
  const rows = buildPortRows([
    { '@cat01': '110', '@cat02': '13001', '@time': '2025000707', $: '-' },
  ]);
  assert.deepEqual(rows, []);
});

// 東京 輸出이 2025-07 154,408 → 2025-08 3,688로 찍힌다. 실물동량이 아니라 미집계로 보인다.
// 그대로 적재하면 사이트에 "도쿄항 98% 감소"가 표시된다.
test('isPlausibleTeu: 직전 이력 중앙값 대비 급락은 거부', () => {
  const history = [300000, 310000, 295000, 305000];
  assert.equal(isPlausibleTeu(3688, history), false);
  assert.equal(isPlausibleTeu(290000, history), true);
});

test('isPlausibleTeu: 완만한 감소는 통과 — 계절성까지 막으면 안 된다', () => {
  const history = [300000, 310000, 295000, 305000];
  assert.equal(isPlausibleTeu(210000, history), true);
});

test('isPlausibleTeu: 이력이 부족하면 판단을 보류하고 통과', () => {
  assert.equal(isPlausibleTeu(3688, []), true);
  assert.equal(isPlausibleTeu(3688, [300000, 310000]), true);
});

test('JP_PORTS: 주요 6항이 UN/LOCODE로 매핑돼 있다', () => {
  for (const code of ['13001', '14001', '14002', '23003', '27006', '28002']) {
    assert.ok(JP_PORTS[code], `항만 코드 ${code} 매핑 누락`);
    assert.match(JP_PORTS[code], /^JP/);
  }
});
