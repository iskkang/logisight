'use strict';
// 뉴스레터 캠페인 식별·귀속 (058 계측).
// 발송 SDK와 분리한 순수 함수 — 부작용 없이 단위 테스트 가능하게 둔다.
const { isoWeek } = require('../../weekly-report/lib/week');

// 캠페인 ID. Resend tag 값 제약(영문·숫자·_·-)을 만족하는 형태로만 만든다.
//   일간 = daily-YYYY-MM-DD / 주간 = weekly-YYYY-Www
function campaignId(kind, now = new Date()) {
  if (kind === 'weekly') return `weekly-${isoWeek(now).id}`;
  return `${kind === 'report' ? 'report' : 'daily'}-${now.toISOString().slice(0, 10)}`;
}

// 자사 사이트 링크에만 UTM 부착 — 뉴스레터→사이트 유입을 analytics_events에서 귀속할 수 있게 한다.
// 외부 기사 링크와 수신거부 링크는 건드리지 않는다(외부 지표 오염·해지 흐름 방해 방지).
function withUtm(html, campaign, siteUrl) {
  const base = String(siteUrl).replace(/\/+$/, '');
  const escaped = base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return String(html).replace(
    new RegExp(`href="(${escaped}(?:/[^"?#]*)?)"`, 'g'),
    (m, url) => (url.includes('/unsubscribe')
      ? m
      : `href="${url}?utm_source=newsletter&utm_medium=email&utm_campaign=${campaign}"`),
  );
}

module.exports = { campaignId, withUtm };
