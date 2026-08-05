'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseJpFeed } = require('./jp_feed');

// CDATA·복수 category·깨진 날짜가 얽혀 조용히 틀리기 쉽다. 실제 피드 모양으로 고정한다.
const XML = `<?xml version="1.0"?><rss version="2.0"><channel>
<item>
  <title><![CDATA[ビームス・豊島参画、港湾でアパレル共同輸送]]></title>
  <link>https://www.logi-today.com/123456</link>
  <pubDate>Tue, 04 Aug 2026 03:00:35 +0000</pubDate>
  <category><![CDATA[ロジスティクス]]></category>
  <category><![CDATA[港湾]]></category>
  <description><![CDATA[<p>アンドエスティHDなど4社が…</p>]]></description>
</item>
<item>
  <title>タグなしの記事</title>
  <link>https://www.logi-today.com/999</link>
  <pubDate>bad-date</pubDate>
  <description>プレーン説明</description>
</item>
<item><title>リンクなし</title></item>
</channel></rss>`;

test('parseJpFeed: CDATA·복수 태그·설명 HTML을 벗겨낸다', () => {
  const items = parseJpFeed(XML, 'LOGISTICS TODAY');
  assert.equal(items.length, 2, 'link 없는 항목은 버린다');
  assert.equal(items[0].title, 'ビームス・豊島参画、港湾でアパレル共同輸送');
  assert.deepEqual(items[0].tags, ['ロジスティクス', '港湾']);
  assert.equal(items[0].blurb, 'アンドエスティHDなど4社が…');
  assert.equal(items[0].publishedAt, '2026-08-04T03:00:35.000Z');
  assert.equal(items[0].source, 'LOGISTICS TODAY');
});

// 날짜가 깨졌다고 기사를 버리면 그날 수집이 통째로 빈다.
test('parseJpFeed: 날짜가 깨져도 기사는 살린다', () => {
  const items = parseJpFeed(XML, 'x');
  assert.equal(items[1].publishedAt, null);
  assert.deepEqual(items[1].tags, []);
  assert.equal(items[1].blurb, 'プレーン説明');
});

test('parseJpFeed: 빈 입력에 안전하다', () => {
  assert.deepEqual(parseJpFeed('', 'x'), []);
  assert.deepEqual(parseJpFeed('<rss><channel></channel></rss>', 'x'), []);
});
