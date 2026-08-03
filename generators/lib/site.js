'use strict';
// generators/lib/site.js
// 사이트 도메인 단일 소스 — 도메인 전환은 SITE_URL 환경변수 하나로 끝난다.
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

const { url: SITE_URL, host: SITE_HOST } = resolveSite();

module.exports = { resolveSite, SITE_URL, SITE_HOST };
