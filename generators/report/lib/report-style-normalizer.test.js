'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeMonthlyReportMarkdown,
  stripImplicationLines,
  stripOpsNoticeLines,
} = require('./report-style-normalizer');

// ── §5 시사점·권고 라인 스트립 ────────────────────────────────────────────────

test('➔ 시사점 라인 제거 (bold 포함)', () => {
  const md = '분석 본문.\n\n➔ **한국 화주 시사점:** 조기 부킹 권고\n\n다음 문단.';
  const out = stripImplicationLines(md);
  assert.doesNotMatch(out, /➔/);
  assert.doesNotMatch(out, /조기 부킹/);
  assert.match(out, /분석 본문\./);
  assert.match(out, /다음 문단\./);
});

test('☞ 라인·blockquote ➔ 라인도 제거', () => {
  const md = '본문.\n☞ MTL 영업팀은 제안 기회\n> ➔ 대비 필요\n끝.';
  const out = stripImplicationLines(md);
  assert.doesNotMatch(out, /☞|➔/);
  assert.match(out, /본문\./);
  assert.match(out, /끝\./);
});

test('화살표 없는 일반 문장은 보존', () => {
  const md = '수급 불균형이 구조적 재편 단계에 진입했음을 시사함.';
  assert.equal(stripImplicationLines(md), md);
});

// ── §0-⑥ 운영 문구 라인 스트립 ────────────────────────────────────────────────

test('⚠️ 미수집 노티스 blockquote 제거', () => {
  const md = '## 03-3. TAC/BAI\n\n> ⚠️ **항공 운임 추세 차트 미수집** — Superset 접속 실패. BAI 스냅샷으로 현황 대체.\n\n본문.';
  const out = stripOpsNoticeLines(md);
  assert.doesNotMatch(out, /미수집|접속 실패/);
  assert.match(out, /## 03-3/);
  assert.match(out, /본문\./);
});

test('수집 실패·다음 호 업데이트 문구 라인 제거', () => {
  const md = 'A.\n> ⚠️ **데이터 미수집** — 수집 실패. 다음 호 업데이트 예정.\nB.';
  const out = stripOpsNoticeLines(md);
  assert.doesNotMatch(out, /수집 실패|다음 호/);
  assert.match(out, /A\./);
  assert.match(out, /B\./);
});

test('일반 본문 속 "실패" 단어(운영 문구 아님)는 보존', () => {
  const md = '협상 실패로 파업이 장기화될 전망.';
  assert.equal(stripOpsNoticeLines(md), md);
});

// ── 통합: normalize가 둘 다 적용 ─────────────────────────────────────────────

test('normalizeMonthlyReportMarkdown: 시사점+노티스 동시 제거', () => {
  const md = '본문.\n\n> ⚠️ **KITA 해상 운임 미수집** — 다음 호 업데이트 예정.\n\n➔ 한국 화주는 대비 필요.\n\n마지막.';
  const out = normalizeMonthlyReportMarkdown(md);
  assert.doesNotMatch(out, /미수집|➔/);
  assert.match(out, /본문\./);
  assert.match(out, /마지막\./);
});
