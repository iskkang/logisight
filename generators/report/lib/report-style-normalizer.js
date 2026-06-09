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

function normalizeMonthlyReportMarkdown(markdown) {
  return stripKeywordOnlyBold(stripStandaloneLeadPeriods(String(markdown)));
}

module.exports = {
  KEYWORD_ONLY_BOLD_TERMS,
  normalizeMonthlyReportMarkdown,
  stripKeywordOnlyBold,
  stripStandaloneLeadPeriods,
};
