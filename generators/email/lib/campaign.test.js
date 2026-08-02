'use strict';
// 계측 배선(058) 검증 — 캠페인 ID 형식과 UTM 부착 범위.
const test = require('node:test');
const assert = require('node:assert/strict');
const { campaignId, withUtm } = require('./campaign');

const SITE = 'https://logisight.mtlship.com';

test('campaignId: 일간은 날짜, 주간은 ISO 주차', () => {
  const d = new Date('2026-08-02T00:00:00Z');   // 2026-W31 일요일
  assert.equal(campaignId('daily', d), 'daily-2026-08-02');
  assert.equal(campaignId('weekly', d), 'weekly-2026-W31');
});

test('campaignId: Resend tag 제약(영문·숫자·_·-)을 만족한다', () => {
  const d = new Date('2026-08-02T00:00:00Z');
  for (const kind of ['daily', 'weekly', 'report']) {
    assert.match(campaignId(kind, d), /^[A-Za-z0-9_-]+$/);
  }
});

test('withUtm: 자사 링크에만 UTM을 붙인다', () => {
  const html = '<a href="https://logisight.mtlship.com/news">기사</a>'
    + '<a href="https://www.seatrade-maritime.com/x">외부</a>';
  const out = withUtm(html, 'daily-2026-08-02', SITE);
  assert.match(out, /mtlship\.com\/news\?utm_source=newsletter&utm_medium=email&utm_campaign=daily-2026-08-02/);
  assert.doesNotMatch(out, /seatrade-maritime\.com\/x\?utm/);
});

test('withUtm: 수신거부 링크는 건드리지 않는다', () => {
  const html = '<a href="https://logisight.mtlship.com/unsubscribe">해지</a>';
  assert.equal(withUtm(html, 'daily-2026-08-02', SITE), html);
});

test('withUtm: 루트 링크도 처리한다', () => {
  const out = withUtm('<a href="https://logisight.mtlship.com">홈</a>', 'weekly-2026-W31', SITE);
  assert.match(out, /mtlship\.com\?utm_source=newsletter&utm_medium=email&utm_campaign=weekly-2026-W31/);
});

test('withUtm: 도메인이 바뀌어도(브랜드 분리) 동작한다', () => {
  const out = withUtm('<a href="https://logisight.com/reports">리포트</a>', 'weekly-2026-W31', 'https://logisight.com');
  assert.match(out, /logisight\.com\/reports\?utm_source=newsletter/);
});
