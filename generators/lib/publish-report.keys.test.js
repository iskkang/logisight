'use strict';
// generators/lib/publish-report.keys.test.js
// id·스토리지 키에 언어가 반드시 들어가는지 검증한다.
//
// 이 테스트가 없어서 실제 사고가 났다. 일본 6월호를 발행했더니 id가
// 'monthly-2026-06-01'로 한국 6월호와 같아 DB 행을 덮어썼고, 스토리지 키도
// 'monthly/2026-06-01.pdf'로 같아 한국 PDF(8.6MB)를 일본 PDF(475KB)로 덮어썼다.
// publishReport는 DB·스토리지를 건드리므로 키 계산만 떼어 검증한다.

const test = require('node:test');
const assert = require('node:assert/strict');
const { reportId, reportPdfKey, reportSite } = require('./publish-report');

test('reportId: 한국판은 접두사 없이 기존 id를 유지한다', () => {
  // 발행 이력·외부 링크가 이 id에 걸려 있어 바꾸면 안 된다.
  assert.equal(reportId('monthly', '2026-06-01', 'ko'), 'monthly-2026-06-01');
  assert.equal(reportId('weekly', '2026-07-27', 'ko'), 'weekly-2026-07-27');
});

test('reportId: 언어를 지정하지 않으면 한국판으로 본다', () => {
  assert.equal(reportId('monthly', '2026-06-01'), 'monthly-2026-06-01');
});

test('reportId: 일본판은 언어 접두사가 붙는다 — 같은 달이라도 id가 갈린다', () => {
  assert.equal(reportId('monthly', '2026-06-01', 'ja'), 'ja-monthly-2026-06-01');
  assert.notEqual(
    reportId('monthly', '2026-06-01', 'ja'),
    reportId('monthly', '2026-06-01', 'ko'),
  );
});

test('reportPdfKey: 일본판은 언어 디렉터리 아래에 둔다', () => {
  assert.equal(reportPdfKey('monthly', '2026-06-01', 'ko'), 'monthly/2026-06-01.pdf');
  assert.equal(reportPdfKey('monthly', '2026-06-01', 'ja'), 'ja/monthly/2026-06-01.pdf');
  assert.notEqual(
    reportPdfKey('monthly', '2026-06-01', 'ja'),
    reportPdfKey('monthly', '2026-06-01', 'ko'),
  );
});

test('reportSite: 언어별 정본 도메인', () => {
  assert.match(reportSite('ja'), /jpn\.logisight\.net/);
  assert.doesNotMatch(reportSite('ko'), /jpn\./);
});

test('reportSite: 모르는 언어는 기본 도메인으로 떨어뜨린다', () => {
  assert.equal(reportSite('xx'), reportSite('ko'));
});
