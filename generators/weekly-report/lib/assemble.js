'use strict';
// weeklyData(코드 표·뉴스) + llmJson(산문) -> 최종 마크다운. 순수 함수.
// 뉴스는 weeklyData의 실제 데이터(제목·소제목·이미지·본문)로 카드 HTML 렌더(LLM 환각 차단).

function weekNum(weekId) { return Number(weekId.split('-W')[1]); }

function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// 뉴스 1건 -> 기사 블록 HTML(카테고리·제목·소제목·히어로 이미지·본문 문단·출처).
// 공백 줄 없는 단일 블록 — marked가 HTML 블록으로 통과.
function newsArticle(n) {
  const lines = ['<div class="news-article">'];
  if (n.category) lines.push(`<span class="news-cat">${esc(n.category)}</span>`);
  lines.push(`<div class="news-title">${esc(n.title)}</div>`);
  if (n.subtitle) lines.push(`<div class="news-sub">${esc(n.subtitle)}</div>`);
  if (n.image) lines.push(`<img class="news-hero" src="${esc(n.image)}" alt="" />`);
  if (n.body) for (const p of n.body.split(/\n+/).filter(Boolean)) lines.push(`<p class="news-p">${esc(p)}</p>`);
  lines.push(`<div class="news-src">출처: ${esc(n.source)}</div>`);
  lines.push('</div>');
  return lines.join('\n');
}

function assembleMarkdown(weeklyData, llm) {
  const { weekId, period, generatedAt, sections } = weeklyData;
  const wn = weekNum(weekId);
  const ov = llm.overview || {};
  const L = [];

  L.push('---');
  L.push('status: draft');
  L.push(`week: ${weekId}`);
  L.push(`period: ${period.start}~${period.end}`);
  L.push(`period_start_iso: ${period.startISO}`);
  L.push(`period_end_iso: ${period.endISO}`);
  L.push(`generated_at: ${generatedAt}`);
  L.push('---', '');

  L.push(`# ${wn}주차 글로벌 물류 시황`, '');
  L.push('| 항목 | 내용 |', '|---|---|');
  L.push(`| 작성일 | ${generatedAt} |`);
  L.push('| 발행 | Logisight |');
  L.push(`| 보고기간 | ${period.start} ~ ${period.end} (${wn}주차) |`, '');

  // Executive Summary — 종합 행이 없으면 overview로 보강
  const exec = [...(llm.execSummary || [])];
  if (!exec.some(r => /종합/.test(r.topic || ''))) {
    exec.unshift({ topic: '종합 시황', signal: ov.signal || '', basis: ov.conclusion || '' });
  }
  L.push('---', '', '## Executive Summary', '');
  L.push('| 주제 | 결론(신호등) | 핵심 근거 |', '|---|---|---|');
  for (const r of exec) L.push(`| ${r.topic} | ${r.signal} | ${r.basis} |`);
  L.push('', '> ※ 신호등은 리스크 수준(🟢 안정 / 🟡 관망 / 🔴 주의)이며 가격 등락색과 무관.', '');

  // 1. 종합
  L.push('---', '', `## ${sections.find(s => s.id === 'overview').title}`, '');
  L.push(`**결론: ${ov.conclusion || ''} (${ov.signal || ''}).**`, '');
  if (ov.events && ov.events.length) {
    L.push('### 핵심 이벤트', '');
    ov.events.forEach((e, i) => L.push(`${i + 1}. ${e}`));
    L.push('');
  }
  L.push('### 종합 해설', '');
  L.push(`- **배경:** ${ov.background || ''}`);
  L.push(`- **분석:** ${ov.analysis || ''}`);
  L.push(`- **시사점:** ${ov.implication || ''}`, '');

  // 2..5
  for (const sec of sections.filter(s => s.id !== 'overview')) {
    const p = (llm.sections || {})[sec.id] || {};
    L.push('---', '', `## ${sec.title}`, '');
    L.push(`**결론: ${p.conclusion || ''} (${p.signal || ''}).**`, '');
    if (sec.table) {
      L.push('### INDEX', '', sec.table, '');
      if (sec.factText) L.push(`> ${sec.factText}`, '');
    }
    L.push('### 이슈', '');
    L.push(`- **배경:** ${p.background || ''}`);
    L.push(`- **분석:** ${p.analysis || ''}`);
    L.push(`- **시사점:** ${p.implication || ''}`, '');
    if (sec.news && sec.news.length) {
      L.push('### 주요 뉴스', '');
      for (const n of sec.news) { L.push(newsArticle(n)); L.push(''); }
    }
  }

  return L.join('\n');
}

module.exports = { assembleMarkdown };
