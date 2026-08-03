'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeHeading } = require('./heading');

const section = { no: '03', title: '港湾' };

// 실제 생성에서 재생성된 섹션이 '## 港湾 主要6港合計は…'로 번호를 잃었다.
// 목차·앵커가 번호에 의존하므로 섹션마다 형식이 흔들리면 안 된다.
test('normalizeHeading: 번호가 없으면 붙인다', () => {
  const out = normalizeHeading('## 港湾 主要6港合計は前年同月比+0.1%\n\n本文', section);
  assert.match(out.split('\n')[0], /^## 03\. 港湾/);
});

test('normalizeHeading: 이미 번호가 있으면 그대로 둔다', () => {
  const line = '## 03. 港湾 ― 主要6港は横ばい';
  assert.equal(normalizeHeading(`${line}\n\n本文`, section).split('\n')[0], line);
});

// 헤드라인은 SEO 자산이라 지워선 안 된다.
test('normalizeHeading: 제목 뒤 헤드라인을 보존한다', () => {
  const out = normalizeHeading('## 港湾 主要6港合計は前年同月比+0.1%\n\n本文', section);
  assert.ok(out.includes('主要6港合計は前年同月比+0.1%'));
});

test('normalizeHeading: 제목명이 중복되지 않는다', () => {
  const out = normalizeHeading('## 港湾 ― 横ばい\n\n本文', section);
  assert.equal((out.split('\n')[0].match(/港湾/g) || []).length, 1);
});

// 실제 생성에서 '## 港湾動向 ― 主要6港…'이 '## 03. 港湾 ― 動向 ― 主要6港…'이 됐다.
// 제목명을 단어 중간에서 잘라내 구분자가 겹쳤다. 모델의 표현은 그대로 두고 번호만 끼운다.
test('normalizeHeading: 제목명으로 시작하는 합성어를 자르지 않는다', () => {
  const out = normalizeHeading('## 港湾動向 ― 主要6港\n\n本文', section).split('\n')[0];
  assert.equal(out, '## 03. 港湾動向 ― 主要6港');
  assert.ok(!/―\s*―/.test(out));
  assert.equal((out.match(/―/g) || []).length, 1);
});

test('normalizeHeading: 제목 줄이 없으면 만들어 붙인다', () => {
  const out = normalizeHeading('本文のみ', section);
  assert.match(out.split('\n')[0], /^## 03\. 港湾$/);
  assert.ok(out.includes('本文のみ'));
});

test('normalizeHeading: 본문은 손대지 않는다', () => {
  const body = '## 03. 港湾\n\n合計117万7717TEU。\n\n港別では東京港。';
  assert.equal(normalizeHeading(body, section), body);
});
