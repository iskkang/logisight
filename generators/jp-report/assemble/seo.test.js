'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { deriveHeadline, deriveTitle, deriveDescription, buildJsonLd } = require('./seo');

const MD = `## 01. 総論 ― 運賃高騰と貿易拡大、荷動きは横ばい

本レポートが扱う運賃、港湾、貿易の各統計は、基準となる月が軸ごとに異なる。企業向けサービス価格指数と貿易統計は2026年6月分である。

---

## 02. 海上・航空運賃

外航貨物輸送は円ベース233.8。`;

test('deriveHeadline: 총론 제목에서 헤드라인만 뽑는다', () => {
  assert.equal(deriveHeadline(MD), '運賃高騰と貿易拡大、荷動きは横ばい');
});

test('deriveHeadline: 헤드라인이 없으면 null', () => {
  assert.equal(deriveHeadline('## 01. 総論\n\n本文'), null);
});

// SEO 가이드: 전각 28~32자. 넘으면 구글 검색결과에서 잘린다.
test('deriveTitle: 헤드라인 + 기간으로 만들고 길이를 지킨다', () => {
  const t = deriveTitle(MD, '2026-06');
  assert.ok(t.includes('運賃高騰'));
  assert.ok(t.includes('2026年6月'));
  assert.ok(t.length <= 32, `제목이 ${t.length}자로 너무 길다: ${t}`);
});

test('deriveTitle: 헤드라인이 길면 잘라서 32자를 지킨다', () => {
  const long = `## 01. 総論 ― ${'あ'.repeat(60)}\n\n本文`;
  const t = deriveTitle(long, '2026-06');
  assert.ok(t.length <= 32, `${t.length}자`);
  assert.ok(t.includes('2026年6月'));
});

test('deriveTitle: 헤드라인이 없으면 기간 기반 기본 제목', () => {
  const t = deriveTitle('## 01. 総論\n\n本文', '2026-06');
  assert.ok(t.includes('2026年6月'));
  assert.ok(t.length > 0);
});

// SEO 가이드: 전각 60~70자.
test('deriveDescription: 첫 본문 문단에서 만들고 길이를 지킨다', () => {
  const d = deriveDescription(MD);
  assert.ok(d.length <= 70, `${d.length}자`);
  assert.ok(d.length > 10);
  assert.ok(!d.includes('#'));
  assert.ok(!d.includes('---'));
});

test('deriveDescription: 본문이 없으면 빈 문자열', () => {
  assert.equal(deriveDescription('## 01. 総論'), '');
});

test('buildJsonLd: Article 스키마 필수 필드', () => {
  const ld = buildJsonLd({
    title: 'タイトル', description: '説明', period: '2026-06',
    url: 'https://jpn.logisight.net/reports/2026-06', publishedAt: '2026-08-03T00:00:00Z',
  });
  assert.equal(ld['@type'], 'Article');
  assert.equal(ld.headline, 'タイトル');
  assert.equal(ld.datePublished, '2026-08-03T00:00:00Z');
  assert.equal(ld.mainEntityOfPage, 'https://jpn.logisight.net/reports/2026-06');
  assert.ok(ld.publisher);
  assert.ok(ld.about.includes('2026'));
});

test('buildJsonLd: JSON 직렬화가 가능하다', () => {
  const ld = buildJsonLd({ title: 't', description: 'd', period: '2026-06', url: 'https://x/y' });
  assert.doesNotThrow(() => JSON.stringify(ld));
});
