'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { kstToday, pickArticles, buildHtml } = require('./newsletter-from-site.lib');
const { SITE_URL } = require('../lib/site');

test('kstToday: UTC 23:00 = KST 다음날', () => {
  assert.equal(kstToday(new Date('2026-06-11T23:00:00Z')), '2026-06-12');
});

test('kstToday: UTC 오전 = KST 같은 날', () => {
  assert.equal(kstToday(new Date('2026-06-12T03:00:00Z')), '2026-06-12');
});

test('pickArticles: 카테고리당 최신 1건, 고정 순서(해상→항공→철도→무역→물류)', () => {
  const rows = [
    { slug: 'a', title: 'rail old', category: '철도', fetched_at: '2026-06-12T01:00:00Z' },
    { slug: 'b', title: 'rail new', category: '철도', fetched_at: '2026-06-12T02:00:00Z' },
    { slug: 'c', title: 'air',      category: '항공', fetched_at: '2026-06-12T01:00:00Z' },
    { slug: 'd', title: 'ocean',    category: '해상', fetched_at: '2026-06-12T01:00:00Z' },
  ];
  assert.deepEqual(pickArticles(rows).map((r) => r.title), ['ocean', 'air', 'rail new']);
});

test('pickArticles: is_hero(메인 기사)가 더 최신 링크보다 우선', () => {
  const rows = [
    { slug: 'link', title: 'ocean link', category: '해상', is_hero: false, fetched_at: '2026-06-12T02:00:00Z' },
    { slug: 'main', title: 'ocean main', category: '해상', is_hero: true,  fetched_at: '2026-06-12T01:00:00Z' },
  ];
  assert.deepEqual(pickArticles(rows).map((r) => r.title), ['ocean main']);
});

test('pickArticles: slug/title/category 없는 행과 null 제외', () => {
  assert.deepEqual(pickArticles([{ title: 'no slug', category: '해상' }, null]), []);
});

test('pickArticles: 빈 배열·undefined 입력 시 빈 배열', () => {
  assert.deepEqual(pickArticles([]), []);
  assert.deepEqual(pickArticles(undefined), []);
});

test('buildHtml: 카드 링크는 사이트 /article/{slug}, 제목 HTML 이스케이프', () => {
  const html = buildHtml(
    [{ slug: '2026-06-12-ocean-x', title: '운임 <상승>', summary: '부제목', category: '해상', image_url: null, image_credit: null }],
    '2026-06-12',
  );
  assert.ok(html.includes(`${SITE_URL}/article/2026-06-12-ocean-x`));
  assert.ok(html.includes('운임 &lt;상승&gt;'));
  assert.ok(html.includes('부제목'));
});

test('buildHtml: 푸터 "웹에서 보기"는 /news로 연결', () => {
  const html = buildHtml(
    [{ slug: 's', title: 't', summary: null, category: '물류', image_url: null, image_credit: null }],
    '2026-06-12',
  );
  assert.ok(html.includes(`${SITE_URL}/news`));
});

test('buildHtml: summary 없으면 생략하고 undefined 문자열이 없어야 함', () => {
  const html = buildHtml(
    [{ slug: 's', title: 't', summary: null, category: '물류', image_url: null, image_credit: null }],
    '2026-06-12',
  );
  assert.ok(!html.includes('undefined'));
});

test('buildHtml: image_url 있으면 img 태그, credit 캡션 포함', () => {
  const html = buildHtml(
    [{ slug: 's', title: 't', summary: 'x', category: '해상', image_url: 'https://img.example/a.jpg', image_credit: 'Unsplash' }],
    '2026-06-12',
  );
  assert.ok(html.includes('https://img.example/a.jpg'));
  assert.ok(html.includes('Photo: Unsplash'));
});

test('buildHtml: image_url의 쌍따옴표는 src 속성에서 이스케이프', () => {
  const html = buildHtml(
    [{ slug: 's', title: 't', summary: null, category: '해상',
       image_url: 'https://cdn.example/x.jpg" onerror="evil()', image_credit: null }],
    '2026-06-12',
  );
  assert.ok(!html.includes('" onerror="'));
  assert.ok(html.includes('&quot;'));
});

test('buildHtml: 기사 0건이어도 유효한 HTML 반환 (throw 없음)', () => {
  const html = buildHtml([], '2026-06-12');
  assert.ok(html.includes('<!DOCTYPE html>'));
  assert.ok(html.includes('Logisight Daily'));
});
