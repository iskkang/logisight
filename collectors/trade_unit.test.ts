import test from 'node:test';
import assert from 'node:assert/strict';

import { toUsd } from './trade_provisional.js';
import { toNum } from './trade_stats.js';

/**
 * 관세청 수출입 API의 단위를 고정한다.
 *
 * 두 수집기가 같은 컬럼(trade_statistics.export_usd)에 쓰는데 한쪽만 ×1000 을 한다.
 * 이걸 보고 "불일치"로 판단해 통일하려는 시도가 실제로 있었다. 통일하면 한쪽이
 * 1000배 틀린다 —— **API 가 다르고, 단위도 다르다.**
 *
 * 2026-08-14 실측(원본 응답을 직접 떠서 확인):
 *
 *   nationtrade/getNationtradeList
 *     <expDlr>20002319069</expDlr>            중국 2026-06 = $20.0B  → 달러
 *     235개국 합계 101,956,159,193             한국 6월 수출 $102.0B
 *
 *   cntyMmUtPrviExpAcrs/getCntyMmUtPrviExpAcrs
 *     <itemUsdAmt00>   101,956,159</itemUsdAmt00>   01~30 누계 → 천 달러
 *
 *   두 값의 비 = 정확히 1000. 같은 숫자를 다른 단위로 준다.
 *
 * 이 테스트가 깨지면 단위를 바꾼 것이다. 바꾸기 전에 위 실측을 다시 해볼 것.
 */

const NATIONTRADE_CN_202606 = '20002319069'; // 달러 원본
const PROVISIONAL_202606_CUM = '  101,956,159'; // 천 달러 원본(공백·콤마 포함)
const NATION_TOTAL_202606 = 101_956_159_193; // 235개국 합계(달러)

test('nationtrade 의 expDlr 은 달러 그대로 — 배율을 곱하지 않는다', () => {
  assert.equal(toNum(NATIONTRADE_CN_202606), 20_002_319_069);
});

test('잠정 API 는 천 달러 — 달러로 올린다', () => {
  assert.equal(toUsd(PROVISIONAL_202606_CUM), 101_956_159_000);
});

// 두 API 가 같은 달의 같은 총액을 준다는 것이 단위 판정의 근거였다.
// 어느 한쪽 변환을 건드리면 이 관계가 먼저 깨진다.
test('같은 달 총액이 두 경로에서 1000배 안에서 일치한다', () => {
  const viaProvisional = toUsd(PROVISIONAL_202606_CUM)!;
  const ratio = NATION_TOTAL_202606 / viaProvisional;
  assert.ok(
    ratio > 0.999 && ratio < 1.001,
    `두 경로의 총액이 어긋난다 (비 ${ratio}). 단위 변환을 확인할 것.`,
  );
});

test('빈 값과 공백은 0 이 아니라 null — 결측을 0 으로 만들지 않는다', () => {
  assert.equal(toNum(''), null);
  assert.equal(toNum('   '), null);
  assert.equal(toNum(undefined), null);
  assert.equal(toUsd(''), null);
  assert.equal(toUsd('   '), null);
  assert.equal(toUsd(undefined), null);
});

test('숫자가 아닌 값도 0 이 아니라 null', () => {
  assert.equal(toNum('-'), null);
  assert.equal(toUsd('N/A'), null);
});

// 0 은 결측이 아니라 "거래가 없었다"이다. null 로 바꾸면 사실을 지우게 된다.
test('진짜 0 은 0 으로 남긴다', () => {
  assert.equal(toNum('0'), 0);
  assert.equal(toUsd('0'), 0);
});
