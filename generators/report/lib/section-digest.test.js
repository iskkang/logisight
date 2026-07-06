'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { extractDigest, buildPriorDigestBlock, buildSynthesisBlock } = require('./section-digest');

const MD = `---
section: macro
status: draft
---
## 06-1. 거시경제·지정학 리스크

**호르무즈 해협 교착 심화…IMO 피난 작전 중단**

본문 문단. Del Monte는 약 4,000만 달러의 비용 압박.

| 표 | 헤더 |
|---|---|
| a | b |

**공급망 불안 속 미약한 물동량 증가세**

## 06-3. 수급 교차 분석

또 다른 본문.
`;

test('extractDigest: 소제목(h2/h3)과 리드 볼드 라인만 추출', () => {
  const d = extractDigest(MD, '06. 거시경제·지정학');
  assert.match(d, /06. 거시경제·지정학/);          // 섹션 제목 포함
  assert.match(d, /06-1\. 거시경제·지정학 리스크/); // h2
  assert.match(d, /호르무즈 해협 교착 심화/);        // 리드 볼드
  assert.match(d, /수급 교차 분석/);
  assert.doesNotMatch(d, /본문 문단/);              // 본문 제외
  assert.doesNotMatch(d, /\| a \| b \|/);           // 표 제외
  assert.doesNotMatch(d, /^---/m);                  // frontmatter 제외
});

test('extractDigest: 라인 수 상한(기본 12) 적용', () => {
  const many = Array.from({ length: 30 }, (_, i) => `## ${i}. 제목${i}`).join('\n\n');
  const d = extractDigest(many, 'X');
  assert.ok(d.split('\n').length <= 13); // 제목 1 + 12
});

test('buildPriorDigestBlock: 다이제스트 없으면 빈 문자열', () => {
  assert.equal(buildPriorDigestBlock([]), '');
});

test('buildPriorDigestBlock: 중복 금지 규칙 + 다이제스트 포함', () => {
  const block = buildPriorDigestBlock(['[02. 해운 시황]\n- 호르무즈 리스크']);
  assert.match(block, /이미 다룬 주제/);
  assert.match(block, /새로운 각도/);
  assert.match(block, /호르무즈 리스크/);
});

test('buildSynthesisBlock: 총론 종합 프레이밍 + 다이제스트 포함 (dedup 문구 아님)', () => {
  const block = buildSynthesisBlock(['[02. 해운 시황]\n- 호르무즈 리스크']);
  assert.match(block, /각 섹션의 핵심/);
  assert.match(block, /종합/);
  assert.match(block, /호르무즈 리스크/);
  assert.doesNotMatch(block, /중복 서술 금지/);   // 총론은 종합이 목적 — dedup 블록과 반대
});

test('buildSynthesisBlock: 빈 입력이면 빈 문자열', () => {
  assert.equal(buildSynthesisBlock([]), '');
});
