'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveSite, resolveSender } = require('./site');

// 발신 주소 — RESEND_API_KEY가 logisight.net이 검증된 계정 키로 교체됐다.
// 기본값이 구 주소로 남아 있으면 변수를 비웠을 때 롤백이 아니라 발송 실패가 된다.
test('resolveSender: NEWSLETTER_EMAIL 미설정 시 정본 발신 주소', () => {
  assert.deepEqual(resolveSender({}), {
    email: 'newsletter@logisight.net',
    from: 'Logisight <newsletter@logisight.net>',
  });
});

// 오버라이드 값은 기본값과 달라야 검증이 성립한다.
// 구 주소로 되돌리려면 RESEND_API_KEY도 옛 계정 키로 함께 바꿔야 한다.
test('resolveSender: NEWSLETTER_EMAIL 설정 시 그 주소로 발신', () => {
  assert.deepEqual(resolveSender({ NEWSLETTER_EMAIL: 'newsletter@mtlb.co.kr' }), {
    email: 'newsletter@mtlb.co.kr',
    from: 'Logisight <newsletter@mtlb.co.kr>',
  });
});

test('resolveSender: 공백만 있는 값은 미설정과 동일', () => {
  assert.equal(resolveSender({ NEWSLETTER_EMAIL: '   ' }).email, 'newsletter@logisight.net');
});

test('resolveSite: SITE_URL 미설정 시 정본 도메인', () => {
  assert.deepEqual(resolveSite({}), {
    url: 'https://logisight.net',
    host: 'logisight.net',
  });
});

// 오버라이드 값은 기본값과 달라야 검증이 성립한다 — 구 도메인(롤백 경로)으로 확인
test('resolveSite: SITE_URL 설정 시 그 값을 사용', () => {
  assert.deepEqual(resolveSite({ SITE_URL: 'https://logisight.mtlship.com' }), {
    url: 'https://logisight.mtlship.com',
    host: 'logisight.mtlship.com',
  });
});

test('resolveSite: 끝 슬래시 제거 — 경로 조립 시 이중 슬래시 방지', () => {
  assert.equal(
    resolveSite({ SITE_URL: 'https://logisight.mtlship.com/' }).url,
    'https://logisight.mtlship.com',
  );
});

test('resolveSite: 빈 문자열·공백은 미설정과 동일하게 처리', () => {
  assert.equal(resolveSite({ SITE_URL: '   ' }).url, 'https://logisight.net');
});
