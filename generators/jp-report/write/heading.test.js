'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeHeading, insertAfterHeading, numberSubsections, composeSection } = require('./heading');

// 참조 리포트는 섹션 제목(본문 없는 구분선)과 번호 붙은 소섹션을 둘 다 갖는다.
// 첫 판에서는 normalizeHeading이 첫 제목을 섹션 제목으로 덮어써
// '## 03. 03-1. 主要6港'처럼 번호가 겹치고 나머지 소섹션은 번호를 잃었다.
const FREIGHT = { no: '02', title: '海上・航空運賃', subsections: ['02-1. 外航海上', '02-2. 国際航空'] };

test('numberSubsections: 번호가 없는 소섹션에 위치대로 번호를 매긴다', () => {
  const out = numberSubsections('## 外航海上 ― 乖離\n\n本文。\n\n## 国際航空\n\n本文。', FREIGHT);
  assert.deepEqual(out.split('\n').filter((l) => l.startsWith('#')),
    ['## 02-1. 外航海上 ― 乖離', '## 02-2. 国際航空']);
});

test('numberSubsections: 헤드라인은 보존한다', () => {
  const out = numberSubsections('## 外航海上 ― 円ベースが突出\n\n本文。', FREIGHT);
  assert.ok(out.includes('外航海上 ― 円ベースが突出'));
});

test('numberSubsections: 이미 붙은 번호는 갈아 끼운다(중복시키지 않는다)', () => {
  const out = numberSubsections('## 02-1. 外航海上\n\n本文。\n\n## 02-2. 国際航空\n\n本文。', FREIGHT);
  assert.deepEqual(out.split('\n').filter((l) => l.startsWith('#')),
    ['## 02-1. 外航海上', '## 02-2. 国際航空']);
});

// 모델이 섹션 제목까지 쓰면 소섹션 번호가 한 칸씩 밀린다.
test('numberSubsections: 모델이 쓴 섹션 제목은 뺀다', () => {
  const out = numberSubsections('## 海上・航空運賃\n\n## 外航海上\n\n本文。', FREIGHT);
  assert.deepEqual(out.split('\n').filter((l) => l.startsWith('#')), ['## 02-1. 外航海上']);
});

test('composeSection: 섹션 제목 → 표 → 소섹션 순으로 조립한다', () => {
  const out = composeSection('## 外航海上\n\n本文。', FREIGHT, '| a |\n|---|');
  const heads = out.split('\n').filter((l) => l.startsWith('#') || l.startsWith('|'));
  assert.deepEqual(heads, ['## 02. 海上・航空運賃', '| a |', '|---|', '## 02-1. 外航海上']);
});

// 맺음말 라벨('今月のフレーム')이 달마다 바뀌면 월간 시리즈에서 독자가 알아보지 못한다.
// 실제로 한 회차는 '## 05. 円ベースと契約通貨ベースの乖離'로 라벨이 통째로 사라졌다.
const CLOSING = { no: '05', title: '今月のフレーム', keepTitle: true };

test('normalizeHeading: keepTitle이면 라벨을 남기고 헤드라인을 뒤에 붙인다', () => {
  const out = normalizeHeading('## 円ベースと基準月のずれ\n\n本文', CLOSING);
  assert.equal(out.split('\n')[0], '## 05. 今月のフレーム ― 円ベースと基準月のずれ');
});

test('normalizeHeading: keepTitle — 라벨이 이미 있으면 겹치지 않는다', () => {
  const out = normalizeHeading('## 05. 今月のフレーム ― 円ベースのずれ\n\n本文', CLOSING);
  assert.equal(out.split('\n')[0], '## 05. 今月のフレーム ― 円ベースのずれ');
});

test('normalizeHeading: keepTitle — 헤드라인이 없으면 라벨만 쓴다', () => {
  assert.equal(normalizeHeading('## 今月のフレーム\n\n本文', CLOSING).split('\n')[0], '## 05. 今月のフレーム');
});

// 총론·맺음말은 소섹션이 없다. 모델이 쓴 헤드라인 제목을 살려야 한다.
test('composeSection: 소섹션이 없는 섹션은 헤드라인 제목을 살린다', () => {
  const s = { no: '01', title: '総論' };
  const out = composeSection('## 運賃急伸と貿易赤字\n\n本文。', s, '');
  assert.equal(out.split('\n')[0], '## 01. 運賃急伸と貿易赤字');
});

// 표는 코드가 그려 섹션 제목 바로 뒤에 끼운다(참조 리포트와 같은 배치).
test('insertAfterHeading: 첫 제목 뒤에 블록을 넣는다', () => {
  const out = insertAfterHeading('## 03. 港湾\n\n本文である。', '| a |\n|---|');
  const lines = out.split('\n').filter((l) => l.trim());
  assert.equal(lines[0], '## 03. 港湾');
  assert.equal(lines[1], '| a |');
  assert.ok(out.indexOf('本文である。') > out.indexOf('|---|'));
});

test('insertAfterHeading: 소섹션 제목이 아니라 첫 제목 뒤에 넣는다', () => {
  const body = '## 03. 港湾\n\n概要。\n\n## 03-1. 主要6港\n\n詳細。';
  const out = insertAfterHeading(body, 'TABLE');
  assert.ok(out.indexOf('TABLE') < out.indexOf('概要。'));
});

test('insertAfterHeading: 제목이 없으면 맨 앞에 넣는다', () => {
  assert.ok(insertAfterHeading('本文のみ', 'TABLE').startsWith('TABLE'));
});

test('insertAfterHeading: 빈 블록이면 그대로 둔다', () => {
  const body = '## 03. 港湾\n\n本文。';
  assert.equal(insertAfterHeading(body, ''), body);
});

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
