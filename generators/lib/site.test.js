'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveSite } = require('./site');

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
