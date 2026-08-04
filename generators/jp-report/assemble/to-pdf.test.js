'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { inlineCharts, insertDividers, stripWebHeader } = require('./to-pdf');

// 表紙が題名を持つ。本文の<h1>を残すと、その2行だけで1ページを使う。
test('stripWebHeader: 웹용 제목과 발행 메타를 뺀다', () => {
  const html = '<h1>タイトル</h1>\n<div class="meta">2026年6月 · Logisight</div>\n<h2>01. 総論</h2>';
  assert.equal(stripWebHeader(html), '<h2>01. 総論</h2>');
});

test('stripWebHeader: 본문의 h2와 표는 건드리지 않는다', () => {
  const html = '<h2>01. 総論</h2><table><tr><td>233.8</td></tr></table>';
  assert.equal(stripWebHeader(html), html);
});

// setContent は相対パスを解決しない。参照のままだと図が空欄で出る。
test('inlineCharts: 이미지 참조를 SVG 본문으로 바꾼다', () => {
  const out = inlineCharts('<p><img src="./a.svg" alt="図"></p>', [{ svgFile: 'a.svg', alt: '図', svg: '<svg/>' }]);
  assert.ok(out.includes('<figure><svg/></figure>'));
  assert.ok(!out.includes('<img'));
});

// SVG 자체가 제목·부제를 갖는다. alt를 캡션으로 덧붙이면 같은 문구가 두 번 나온다.
test('inlineCharts: 캡션을 덧붙이지 않는다', () => {
  const out = inlineCharts('<img src="./a.svg">', [{ svgFile: 'a.svg', alt: '図', svg: '<svg/>' }]);
  assert.ok(!out.includes('figcaption'));
});

test('insertDividers: 각 섹션 견출 앞에 구분면을 넣는다', () => {
  const out = insertDividers('<h2>01. 総論</h2><p>x</p><h2>02. 海運</h2>');
  assert.equal((out.match(/class="divider"/g) || []).length, 2);
  assert.ok(out.indexOf('divider') < out.indexOf('01. 総論'));
});

// 小見出し(02-1.)まで扉にすると、節ごとに扉が何枚も入る。
test('insertDividers: 소섹션에는 구분면을 넣지 않는다', () => {
  const out = insertDividers('<h2>02. 海運</h2><h2>02-1. 世界のスポット指数</h2>');
  assert.equal((out.match(/class="divider"/g) || []).length, 1);
});
