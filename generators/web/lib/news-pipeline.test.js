'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseKsgArticle, sanitizeArticleUrl } = require('./news-pipeline');

// 원문 URL 검증 — 스킴 접두어(/^https?:\/\//)만 보면 앵커 쓰레기 값이 통과해
// 사이트에서 깨진 리다이렉트(Location: https://javascript:void(0);)가 나갔다.
test('sanitizeArticleUrl: 정상 기사 URL은 그대로', () => {
  assert.equal(
    sanitizeArticleUrl('https://splash247.com/a-b-c'),
    'https://splash247.com/a-b-c',
  );
  assert.equal(sanitizeArticleUrl('http://www.ksg.co.kr/news/1?a=2'), 'http://www.ksg.co.kr/news/1?a=2');
});

test('sanitizeArticleUrl: 스킴 접두어만 맞는 값 — 실제 수집된 https://javascript:void(0);', () => {
  assert.equal(sanitizeArticleUrl('https://javascript:void(0);'), null);
});

test('sanitizeArticleUrl: 점 없는 호스트는 거부', () => {
  assert.equal(sanitizeArticleUrl('https://javascript'), null);
  assert.equal(sanitizeArticleUrl('https://localhost/x'), null);
});

test('sanitizeArticleUrl: http(s) 아닌 스킴 거부', () => {
  assert.equal(sanitizeArticleUrl('javascript:void(0);'), null);
  assert.equal(sanitizeArticleUrl('mailto:a@b.com'), null);
});

test('sanitizeArticleUrl: 상대경로·빈값·null 거부', () => {
  assert.equal(sanitizeArticleUrl('/news/1'), null);
  assert.equal(sanitizeArticleUrl('  '), null);
  assert.equal(sanitizeArticleUrl(null), null);
  assert.equal(sanitizeArticleUrl(undefined), null);
});

test('parseKsgArticle: TITLE/BODY 분리', () => {
  const r = parseKsgArticle(
    'TITLE: 중동행 컨운임 4300弗 돌파…사상최고치\nBODY:\n' + '운임이 급등했다. '.repeat(20),
  );
  assert.equal(r.title, '중동행 컨운임 4300弗 돌파…사상최고치');
  assert.ok(r.body.startsWith('운임이 급등했다.'));
  assert.ok(!r.body.includes('TITLE:'));
});

test('parseKsgArticle: TITLE/BODY 라벨 없으면 전체를 본문으로, title=null', () => {
  const raw = '운임이 올랐다. '.repeat(20);
  const r = parseKsgArticle(raw);
  assert.equal(r.title, null);
  assert.ok(r.body.length >= 100);
});

test('parseKsgArticle: 본문 100자 미만이면 null', () => {
  assert.equal(parseKsgArticle('TITLE: 짧은제목\nBODY:\n너무 짧다'), null);
});

test('parseKsgArticle: 빈 입력이면 null', () => {
  assert.equal(parseKsgArticle(''), null);
  assert.equal(parseKsgArticle(null), null);
});

test('parseKsgArticle: 제목만 있고 본문 없으면 null', () => {
  assert.equal(parseKsgArticle('TITLE: 제목만 있음'), null);
});

test('parseKsgArticle: 말미 "본 기사는…" 디스클레이머 제거, 출처 줄은 유지', () => {
  const body = '운임이 올랐다고 밝혔다. '.repeat(15) + '\n\n*출처: RailFreight*\n\n본 기사는 원문에서 확인된 사실만으로 작성됐습니다.';
  const r = parseKsgArticle('TITLE: 운임 4300弗 돌파\nBODY:\n' + body);
  assert.ok(r.body.includes('*출처: RailFreight*'));
  assert.ok(!r.body.includes('본 기사는'));
  assert.ok(r.body.trimEnd().endsWith('*출처: RailFreight*'));
});
