'use strict';
// weeklyData(코드 표) + llmJson(산문) -> 최종 마크다운. 순수 함수.

function weekNum(weekId) { return Number(weekId.split('-W')[1]); }

function assembleMarkdown(weeklyData, llm) {
  const { weekId, period, generatedAt, sections } = weeklyData;
  const wn = weekNum(weekId);
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
  L.push('| 작성자 | 경영기획팀 |');
  L.push('| 보고대상 | 임원회의 |');
  L.push(`| 보고기간 | ${period.start} ~ ${period.end} (${wn}주차) |`, '');

  L.push('---', '', '## Executive Summary', '');
  L.push('| 주제 | 결론(신호등) | 핵심 근거 |', '|---|---|---|');
  for (const r of llm.execSummary || []) L.push(`| ${r.topic} | ${r.signal} | ${r.basis} |`);
  L.push('', '> ※ 신호등은 리스크 수준(🟢 안정 / 🟡 관망 / 🔴 주의)이며 가격 등락색과 무관.', '');

  const ov = llm.overview || {};
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
    if (p.news && p.news.length) {
      L.push('### 뉴스 (결론 뒷받침)', '');
      for (const n of p.news) L.push(`- ${n.title} — [${n.source}]${n.note ? ` *(${n.note})*` : ''}`);
      L.push('');
    }
    if (p.sowhat) L.push(`➔ **한국 화주 시사점:** ${p.sowhat}`, '');
  }

  return L.join('\n');
}

module.exports = { assembleMarkdown };
