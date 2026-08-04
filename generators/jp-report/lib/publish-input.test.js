'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  periodLabel,
  periodEnd,
  deriveTitle,
  deriveSummary,
  buildPublishInput,
} = require('./publish-input');

const MD = [
  '## 01. 円建て運賃急伸、港湾は横ばい',
  '',
  'まず期間の違いを断っておく。企業向けサービス価格指数は2026年6月、港湾統計は2026年5月である。',
  '',
  '外航貨物輸送は円ベースで233.8だった。',
  '',
  '---',
  '',
  '## 02. 海上・航空運賃',
  '',
  '| 系列 | 円ベース |',
  '|---|---|',
].join('\n');

test('periodLabel: 일본식 월 표기', () => {
  assert.equal(periodLabel('2026-06'), '2026年6月号');
  assert.equal(periodLabel('2026-12'), '2026年12月号');
});

test('periodLabel: 형식이 어긋나면 던진다 — 조용히 넘기면 잘못된 라벨이 발행된다', () => {
  assert.throws(() => periodLabel('2026/06'));
});

// period_end는 월말이어야 한다. 12월은 연도가 넘어가므로 따로 확인한다.
test('periodEnd: 월말을 낸다', () => {
  assert.equal(periodEnd('2026-06'), '2026-06-30');
  assert.equal(periodEnd('2026-02'), '2026-02-28');
  assert.equal(periodEnd('2026-12'), '2026-12-31');
});

test('deriveTitle: 총론 헤드라인을 제목으로 쓴다', () => {
  assert.equal(deriveTitle(MD, '2026-06'), '円建て運賃急伸、港湾は横ばい — 2026年6月号');
});

// 헤드라인이 없다고 발행을 막을 이유는 없다. 월 라벨로 떨어뜨린다.
test('deriveTitle: 총론 제목이 없으면 월 라벨로', () => {
  assert.equal(deriveTitle('本文のみ', '2026-06'), '物流マーケットレポート 2026年6月号');
});

test('deriveSummary: 총론 첫 문단', () => {
  assert.match(deriveSummary(MD), /^まず期間の違いを断っておく/);
});

// 표·주석·구분선을 요약으로 뽑으면 목록에 표 조각이 뜬다.
test('deriveSummary: 표·주석·제목은 건너뛴다', () => {
  const md = '## 01. 見出し\n\n| a |\n|---|\n\n※ 出典\n\n本当の本文である。';
  assert.equal(deriveSummary(md), '本当の本文である。');
});

test('deriveSummary: 총론이 없으면 null', () => {
  assert.equal(deriveSummary('## 02. 運賃\n\n本文'), null);
});

// lang을 안 박으면 기본값 'ko'가 되어 한국 사이트 목록에 일본 리포트가 뜬다.
test('buildPublishInput: lang=ja를 반드시 박는다', () => {
  const inp = buildPublishInput({ period: '2026-06', markdown: MD, pdfPath: '/tmp/x.pdf' });
  assert.equal(inp.lang, 'ja');
  assert.equal(inp.type, 'monthly');
  assert.equal(inp.periodStart, '2026-06-01');
  assert.equal(inp.periodEnd, '2026-06-30');
  assert.equal(inp.webUrl, 'https://jpn.logisight.net/reports/monthly/2026-06');
});
