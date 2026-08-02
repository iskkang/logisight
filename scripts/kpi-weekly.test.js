'use strict';
// 주간 KPI 다이제스트 포맷터 검증.
// 핵심 관심사: 미수집(—)과 0건을 섞지 않는 것 — 오픈 직후 지표 해석을 왜곡하지 않아야 한다.
const test = require('node:test');
const assert = require('node:assert/strict');
const { formatDigest, sum, delta } = require('./kpi-weekly');

const base = {
  periodStart: '2026-07-27', periodEnd: '2026-08-02',
  subscribers: { active: 120, new7d: 8, unsub7d: 1 },
  site: {
    sessions: 400, page_views: 900, reads_50: 120, report_views: 60, report_downloads: 14,
    track_record_views: 33, subscribe_opens: 90, subscribe_submits: 20, subscribe_done: 16,
  },
  sitePrev: {
    sessions: 320, page_views: 800, reads_50: 100, report_views: 50, report_downloads: 10,
    track_record_views: 20, subscribe_opens: 70, subscribe_submits: 15, subscribe_done: 12,
  },
  campaigns: [{
    campaign_id: 'daily-2026-08-01', recipients: 120, delivered: 118,
    open_rate_pct: 41.5, click_rate_pct: 9.3,
  }],
  topContent: [{ content_key: 'scfi-surge', content_type: 'article', views: 210, reads_50: 88 }],
  forecast: { resolved: 12, hit: 7, partial: 3, miss: 2, open: 5, hitRatePct: 58.3, weightedPct: 70.8 },
};

test('핵심 지표와 WoW 증감을 표시한다', () => {
  const out = formatDigest(base);
  assert.match(out, /활성 120명/);
  assert.match(out, /세션 400 \(▲\+25% WoW\)/);
  assert.match(out, /적중률 58\.3% · 가중점수 70\.8%/);
  assert.match(out, /daily-2026-08-01 · 발송 120 · 도달 118 · 오픈 41\.5% · 클릭 9\.3%/);
});

test('구독 퍼널 3단과 세션→구독 전환율을 낸다', () => {
  const out = formatDigest(base);
  assert.match(out, /폼 노출 90 → 제출 20 → 완료 16/);
  assert.match(out, /세션→구독 전환율 4\.0%/);
});

test('표본 10건 미만이면 적중률에 경고를 붙인다', () => {
  const few = { ...base, forecast: { ...base.forecast, resolved: 4, hit: 3, partial: 0, miss: 1, hitRatePct: 75, weightedPct: 75 } };
  assert.match(formatDigest(few), /표본 부족/);
  assert.doesNotMatch(formatDigest(base), /표본 부족/);
});

test('미수집(null)은 0이 아니라 —로 표시한다', () => {
  const empty = {
    ...base,
    site: { ...base.site, sessions: null, page_views: null },
    sitePrev: { ...base.sitePrev, sessions: null, page_views: null },
  };
  const out = formatDigest(empty);
  assert.match(out, /세션 —/);
  assert.doesNotMatch(out, /세션 0/);
});

test('발송·판정이 없으면 0%로 위장하지 않고 없음으로 적는다', () => {
  const out = formatDigest({
    ...base, campaigns: [], topContent: [],
    forecast: { resolved: 0, hit: 0, partial: 0, miss: 0, open: 3, hitRatePct: null, weightedPct: null },
  });
  assert.match(out, /이번 주 발송 없음/);
  assert.match(out, /판정 완료 전망 없음/);
  assert.match(out, /진행 중 전망 3건/);
  assert.doesNotMatch(out, /적중률 0%/);
});

test('캠페인 미귀속 반응이 있으면 경고한다 (오픈율 0% 오독 방지)', () => {
  assert.match(formatDigest({ ...base, orphanEvents: 42 }), /캠페인 미귀속 반응 42건/);
  assert.doesNotMatch(formatDigest({ ...base, orphanEvents: 0 }), /미귀속/);
});

test('sum: 표본이 없으면 0이 아니라 null', () => {
  assert.equal(sum([], 'sessions'), null);
  assert.equal(sum(null, 'sessions'), null);
  assert.equal(sum([{ sessions: 2 }, { sessions: 3 }], 'sessions'), 5);
});

test('delta: 기준값이 없거나 0이면 증감을 만들어내지 않는다', () => {
  assert.equal(delta(10, null), '');
  assert.equal(delta(10, 0), '');
  assert.equal(delta(null, 10), '');
});
