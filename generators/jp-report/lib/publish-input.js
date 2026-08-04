'use strict';
// generators/jp-report/lib/publish-input.js
// 발행 입력 조립 — 순수 함수. 파일도 DB도 건드리지 않는다.

/** "2026-06" → "2026年6月号" */
function periodLabel(period) {
  const m = /^(\d{4})-(\d{2})$/.exec(period);
  if (!m) throw new Error(`period 형식 오류: ${period}`);
  return `${m[1]}年${Number(m[2])}月号`;
}

/** 그 달의 마지막 날. period_end는 월말이어야 한다. */
function periodEnd(period) {
  const m = /^(\d{4})-(\d{2})$/.exec(period);
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const last = new Date(Date.UTC(mo === 12 ? y + 1 : y, mo === 12 ? 0 : mo, 0));
  return last.toISOString().slice(0, 10);
}

/**
 * 총론(01) 제목을 리포트 제목으로 쓴다. 헤드라인이 그 달을 한 줄로 요약한다.
 * 제목이 없으면 월 라벨로 떨어뜨린다 — 발행을 막을 정도의 문제는 아니다.
 */
function deriveTitle(markdown, period) {
  const m = /^##\s*01\.\s*(.+)$/m.exec(markdown || '');
  const head = m ? m[1].trim() : '';
  return head ? `${head} — ${periodLabel(period)}` : `物流マーケットレポート ${periodLabel(period)}`;
}

/** 총론 첫 문단을 요약으로 쓴다. 표·주석·제목 줄은 뺀다. */
function deriveSummary(markdown) {
  const body = String(markdown || '');
  const start = body.search(/^##\s*01\./m);
  if (start < 0) return null;
  const after = body.slice(body.indexOf('\n', start) + 1);
  for (const block of after.split(/\n{2,}/)) {
    const t = block.trim();
    if (!t || t.startsWith('#') || t.startsWith('|') || t.startsWith('※') || t.startsWith('---')) continue;
    return t.replace(/\s+/g, ' ').slice(0, 300);
  }
  return null;
}

function buildPublishInput({ period, markdown, pdfPath }) {
  return {
    type: 'monthly',
    lang: 'ja',
    periodStart: `${period}-01`,
    periodEnd: periodEnd(period),
    periodLabel: periodLabel(period),
    title: deriveTitle(markdown, period),
    summary: deriveSummary(markdown),
    pdfPath,
    webUrl: `https://jpn.logisight.net/reports/monthly/${period}`,
  };
}

module.exports = { periodLabel, periodEnd, deriveTitle, deriveSummary, buildPublishInput };
