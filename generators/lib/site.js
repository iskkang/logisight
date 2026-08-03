'use strict';
// generators/lib/site.js
// 사이트 도메인·발신 주소 단일 소스 — 전환은 환경변수 하나로 끝난다.
// 정본은 apex(www 아님) — www.logisight.net은 apex로 308 리다이렉트된다.
// 문제 시 SITE_URL=https://logisight.mtlship.com 으로 구 도메인 롤백 가능.

const DEFAULT_SITE_URL = 'https://logisight.net';

/**
 * @param {Record<string,string|undefined>} [env]
 * @returns {{url: string, host: string}} url=링크용(끝 슬래시 없음), host=표기용(스킴 제외)
 */
function resolveSite(env = process.env) {
  const raw = (env.SITE_URL || '').trim() || DEFAULT_SITE_URL;
  const url = raw.replace(/\/+$/, '');
  return { url, host: url.replace(/^https?:\/\//, '') };
}

// 발신 주소는 도메인과 별개로 움직인다 — Resend에 logisight.net 도메인 검증(DKIM·SPF)이
// 끝나기 전에 바꾸면 발송이 전부 실패하므로, 기본값은 현행 주소로 두고 검증 완료 후 전환한다.
const DEFAULT_NEWSLETTER_EMAIL = 'newsletter@mtlb.co.kr';
const SENDER_NAME = 'Logisight';

/**
 * @param {Record<string,string|undefined>} [env]
 * @returns {{email: string, from: string}} email=표기용 주소, from=Resend에 넘길 발신자 문자열
 */
function resolveSender(env = process.env) {
  const email = (env.NEWSLETTER_EMAIL || '').trim() || DEFAULT_NEWSLETTER_EMAIL;
  return { email, from: `${SENDER_NAME} <${email}>` };
}

const { url: SITE_URL, host: SITE_HOST } = resolveSite();
const { email: NEWSLETTER_EMAIL, from: NEWSLETTER_FROM } = resolveSender();

module.exports = {
  resolveSite,
  resolveSender,
  SITE_URL,
  SITE_HOST,
  NEWSLETTER_EMAIL,
  NEWSLETTER_FROM,
};
