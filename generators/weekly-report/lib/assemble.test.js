'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { assembleMarkdown } = require('./assemble');

const wd = {
  weekId: '2026-W24', period: { start: '06/08', end: '06/14', startISO: '2026-06-08', endISO: '2026-06-14' }, generatedAt: '2026-06-14',
  sections: [
    { id: 'overview', title: '1. 주간 글로벌 시황 정리', table: null, factText: '', news: [] },
    {
      id: 'ocean', title: '2. 해상', table: '| 지수 | 최신값 |\n|---|---|\n| SCFI | 2985 |', factText: '출처: freight_indices',
      news: [{ category: '해상', title: '운임 급등 기사', source: 'Seatrade', url: 'https://x/1', subtitle: '미주 노선 급등', image: 'https://img/1.jpg', body: '첫 문단.\n둘째 문단.' }],
    },
  ],
};
const llm = {
  execSummary: [{ topic: '해상', signal: '🔴', basis: '운임 급등' }],
  overview: { signal: '🟡', conclusion: '변동성 확대 예상', events: ['운임 급등'], background: 'b', analysis: 'a', implication: 'i' },
  sections: { ocean: { signal: '🔴', conclusion: '과열 구간 진입', background: 'b', analysis: 'a', implication: 'i', sowhat: '조기 부킹 권고' } },
};

test('produces frontmatter draft + cover + exec summary + injected ocean table', () => {
  const md = assembleMarkdown(wd, llm);
  assert.match(md, /status: draft/);
  assert.match(md, /# 24주차 글로벌 물류 시황/);
  assert.match(md, /## Executive Summary/);
  assert.match(md, /\| SCFI \| 2985 \|/);
  assert.match(md, /과열 구간 진입/);
  assert.match(md, /➔/);
});

test('renders news as article blocks from weeklyData (category/title/subtitle/hero/body)', () => {
  const md = assembleMarkdown(wd, llm);
  assert.match(md, /<div class="news-article">/);
  assert.match(md, /<span class="news-cat">해상<\/span>/);
  assert.match(md, /운임 급등 기사/);
  assert.match(md, /미주 노선 급등/);
  assert.match(md, /<img class="news-hero" src="https:\/\/img\/1\.jpg"/);
  assert.match(md, /<p class="news-p">첫 문단\.<\/p>/);
  assert.match(md, /<p class="news-p">둘째 문단\.<\/p>/);
});

test('Executive Summary auto-adds 종합 row from overview when missing', () => {
  const md = assembleMarkdown(wd, llm);
  assert.match(md, /\| 종합 시황 \| 🟡 \| 변동성 확대 예상 \|/);
});
