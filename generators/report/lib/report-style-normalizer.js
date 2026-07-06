'use strict';

const KEYWORD_ONLY_BOLD_TERMS = [
  'SCFI',
  'KCCI',
  'CCFI',
  'WCI',
  'BDI',
  'BAF',
  'EBS',
  'IATA',
  'KITA',
  'TAC/BAI',
  'TAC',
  'BAI',
  'Drewry',
  'Xeneta',
  'IEEPA',
  'GRI',
  'PSS',
  'USD',
  'TEU',
  'FEU',
  'FBX',
  'HRCI',
  'KOBC',
  'SSE',
  'CBP',
  'CIT',
  'TCR',
  'TSR',
  '운임',
  '수요',
  '공급',
  '선복',
  '유가',
  '환율',
  '계약',
  '현물',
  '성수기',
  '물동량',
  '컨테이너',
  '항공',
  '해상',
  '철도',
  '해운',
  '관세',
];

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripStandaloneLeadPeriods(markdown) {
  return markdown.replace(/^(\s*\*\*[^*\n]{1,80})\.\*\*\s*$/gm, '$1**');
}

function stripKeywordOnlyBold(markdown) {
  let output = markdown;

  for (const term of KEYWORD_ONLY_BOLD_TERMS) {
    const exactBold = new RegExp(`\\*\\*\\s*${escapeRegex(term)}\\s*\\*\\*`, 'g');
    output = output.replace(exactBold, term);
  }

  return output;
}

// §5 시사점·권고 금지: ➔/☞로 시작하는 라인(blockquote 포함) 전체 제거.
function stripImplicationLines(markdown) {
  return markdown.replace(/^[ \t]*(?:>[ \t]*)?[➔☞].*$\n?/gm, '');
}

// §0-⑥ 운영 문구 노출 금지: 미수집/수집·접속 실패/다음 호 업데이트가 포함된 라인 제거.
// (일반 본문의 "협상 실패" 등은 보존 — 운영 문구 패턴에만 매칭)
function stripOpsNoticeLines(markdown) {
  return markdown.replace(/^.*(?:미수집|(?:수집|접속) 실패|다음 호 업데이트).*$\n?/gm, '');
}

function normalizeMonthlyReportMarkdown(markdown) {
  return stripKeywordOnlyBold(
    stripStandaloneLeadPeriods(
      stripOpsNoticeLines(stripImplicationLines(String(markdown))),
    ),
  );
}

module.exports = {
  KEYWORD_ONLY_BOLD_TERMS,
  normalizeMonthlyReportMarkdown,
  stripKeywordOnlyBold,
  stripStandaloneLeadPeriods,
  stripImplicationLines,
  stripOpsNoticeLines,
};
