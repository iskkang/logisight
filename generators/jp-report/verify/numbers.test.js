'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseJpNumber, extractNumbers, verifyNumbers } = require('./numbers');

// ── 일본어 수치 표기 파싱 ────────────────────────────────────────────────
test('parseJpNumber: 쉼표·소수', () => {
  assert.equal(parseJpNumber('1,177,717'), 1177717);
  assert.equal(parseJpNumber('233.8'), 233.8);
});

test('parseJpNumber: 万·億·兆 복합 표기', () => {
  assert.equal(parseJpNumber('117万7,717'), 1177717);
  assert.equal(parseJpNumber('10兆9,270億'), 10.927e12);
  assert.equal(parseJpNumber('6,156億'), 6156e8);
});

// ▲는 일본 경제기사에서 마이너스다. 부호를 놓치면 감소를 증가로 읽는다.
test('parseJpNumber: ▲·△는 음수, +는 양수', () => {
  assert.equal(parseJpNumber('▲7.09'), -7.09);
  assert.equal(parseJpNumber('△2.62'), -2.62);
  assert.equal(parseJpNumber('+52.8'), 52.8);
});

// ── 본문에서 수치 추출 ──────────────────────────────────────────────────
test('extractNumbers: 단위와 함께 뽑는다', () => {
  const got = extractNumbers('合計117万7,717TEU(前年同月比+0.13%)');
  const vals = got.map((g) => g.value);
  assert.ok(vals.includes(1177717));
  assert.ok(vals.includes(0.13));
});

// 연·월은 수치 검증 대상이 아니다. 걸러내지 않으면 2026·6이 매번 위반으로 잡힌다.
test('extractNumbers: 연·월·일은 제외', () => {
  const got = extractNumbers('2026年6月の輸出は10兆9,270億円だった');
  const vals = got.map((g) => g.value);
  assert.ok(!vals.includes(2026));
  assert.ok(!vals.includes(6));
  assert.ok(vals.includes(10.927e12));
});

// 主要6港·13品目처럼 개수를 세는 조수사는 데이터 주장이 아니다.
// 실제 샘플 검증에서 '主要6港'의 6이 위반으로 잡혀 오탐이 났다.
test('extractNumbers: 조수사가 붙은 개수는 제외', () => {
  const vals = extractNumbers('主要6港の合計は13品目、3社が対象').map((g) => g.value);
  assert.deepEqual(vals, []);
});

test('extractNumbers: 조수사를 걸러도 실제 수치는 남는다', () => {
  const vals = extractNumbers('主要6港の合計は117万7,717TEU').map((g) => g.value);
  assert.deepEqual(vals, [1177717]);
});

// 목업 검증에서 '## 02. 海上・航空運賃'의 02가 위반으로 잡혔다.
// 섹션 번호는 데이터가 아니라 문서 구조다.
test('extractNumbers: 마크다운 제목의 섹션 번호는 제외', () => {
  const text = '## 02. 海上・航空運賃\n外航貨物輸送は233.8となった。\n### 3. 小見出し';
  const vals = extractNumbers(text).map((g) => g.value);
  assert.deepEqual(vals, [233.8]);
});

test('extractNumbers: 목록 번호도 제외', () => {
  const vals = extractNumbers('1. 最初の項目\n2. 次の項目').map((g) => g.value);
  assert.deepEqual(vals, []);
});

test('extractNumbers: 문맥을 함께 담는다 — REVISE 지시가 구체적이어야 한다', () => {
  const got = extractNumbers('両者には15ポイント超の開きが生じている');
  assert.equal(got.length, 1);
  assert.ok(got[0].context.includes('ポイント'));
});

// ── 팩트시트 대조 ───────────────────────────────────────────────────────
const FACTS = {
  periods: { trade: '2026-06' },
  sppi: { series: [{ name: '外航貨物輸送', yen: 233.8, contract: 160.8, yoyYenPct: 52.8, yoyContractPct: 37.4 }] },
  port: { total: { teu: 1177717, yoyPct: 0.128 }, ports: [{ code: 'JPKWS', teu: 6935, yoyPct: -7.087 }] },
  trade: { total: { exportJpy: 10927000000 } },
};

test('verifyNumbers: 팩트시트에 있는 수치는 통과', () => {
  const r = verifyNumbers('外航貨物輸送は233.8、前年同月比+52.8%となった。', FACTS);
  assert.equal(r.ok, true);
  assert.deepEqual(r.violations, []);
});

test('verifyNumbers: 千円 단위 팩트를 円 표기로 써도 통과', () => {
  // 팩트시트는 千円(10,927,000,000), 본문은 円(10兆9,270億)
  const r = verifyNumbers('輸出総額は10兆9,270億円だった。', FACTS);
  assert.equal(r.ok, true);
});

test('verifyNumbers: 반올림 표기 허용 (0.128 → +0.13%)', () => {
  const r = verifyNumbers('合計は117万7,717TEU(前年同月比+0.13%)。', FACTS);
  assert.equal(r.ok, true);
});

test('verifyNumbers: ▲ 표기도 팩트시트 음수와 매칭', () => {
  const r = verifyNumbers('川崎港は6,935TEU(▲7.09%)。', FACTS);
  assert.equal(r.ok, true);
});

// 샘플 리포트가 실제로 낸 오류다. 233.8-160.8=73인데 15로 썼다.
test('verifyNumbers: 팩트시트에 없는 수치는 위반', () => {
  const r = verifyNumbers('両者には15ポイント超の開きが生じている。', FACTS);
  assert.equal(r.ok, false);
  assert.equal(r.violations.length, 1);
  assert.equal(r.violations[0].value, 15);
  assert.ok(r.violations[0].context.length > 0);
});

test('verifyNumbers: 위반이 여러 건이면 모두 보고한다', () => {
  const r = verifyNumbers('数値は999と888である。', FACTS);
  assert.equal(r.violations.length, 2);
});

test('verifyNumbers: 지수 기준값 100은 허용 — 기준연도 설명에 쓰인다', () => {
  const r = verifyNumbers('契約通貨ベースは100を下回った。', FACTS);
  assert.equal(r.ok, true);
});
