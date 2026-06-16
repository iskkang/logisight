'use strict';
// generators/report/assemble-monthly-report.js
// status: approved 섹션들을 병합해 최종 월간 리포트 마크다운 생성
// 사용법:
//   node assemble-monthly-report.js            # approved 섹션만 병합
//   node assemble-monthly-report.js --force    # draft 포함 전체 병합 (CI용)
//   node assemble-monthly-report.js --month=2026-04  # 과거 월 지정

const fs   = require('fs');
const path = require('path');

const SECTIONS = require('./sections.config');
const { parseFrontmatter } = require('./lib/section-runner');
const { normalizeMonthlyReportMarkdown } = require('./lib/report-style-normalizer');

const TODAY    = new Date().toISOString().slice(0, 10);
const monthArg = process.argv.find(a => a.startsWith('--month='));
const MONTH    = monthArg ? monthArg.split('=')[1] : TODAY.slice(0, 7);

const SEC_DIR  = path.resolve(__dirname, `../../content/monthly-report/${MONTH}`);
const OUT_DIR  = path.resolve(__dirname, '../../content/drafts');
const OUT_PATH = path.join(OUT_DIR, `monthly-analysis-${MONTH}.md`);

function main() {
  if (!fs.existsSync(SEC_DIR)) {
    console.error(`ERROR: 섹션 디렉터리 없음: ${SEC_DIR}`);
    console.error('먼저 실행하세요: node generators/report/run-section.js --all');
    process.exit(1);
  }

  const force    = process.argv.includes('--force');
  const approved = [];
  const skipped  = [];

  for (const sec of SECTIONS) {
    const fpath = path.join(SEC_DIR, `${sec.id}.md`);
    if (!fs.existsSync(fpath)) {
      skipped.push({ id: sec.id, reason: '파일 없음' });
      continue;
    }
    const { meta, body } = parseFrontmatter(fs.readFileSync(fpath, 'utf-8'));
    if (meta.status === 'no-data') {
      skipped.push({ id: sec.id, reason: 'no-data (기사 없음)' });
      continue;
    }
    if (!force && meta.status !== 'approved') {
      skipped.push({ id: sec.id, reason: `status: ${meta.status} — 승인 대기 (--force 로 강제 병합 가능)` });
      continue;
    }
    approved.push({ id: sec.id, title: sec.title, body: body.trim() });
  }

  if (approved.length === 0) {
    console.error('❌ 병합할 섹션이 없습니다.');
    if (!force) {
      console.error('   각 섹션 파일의 frontmatter: status: draft → status: approved 로 변경하세요:');
    }
    console.error(`   ${SEC_DIR}/`);
    if (skipped.length) {
      console.error('스킵된 섹션:');
      for (const s of skipped) console.error(`   ${s.id}: ${s.reason}`);
    }
    process.exit(1);
  }

  const header = [
    `<!-- assembled: ${new Date().toISOString()} by assemble-monthly-report.js -->`,
    `<!-- sections: ${approved.map(s => s.id).join(', ')} (${approved.length}개) -->`,
    '',
    `# Logisight 월간 시장 인텔리전스 — ${MONTH}`,
    '',
    `> 발행일: ${TODAY} | 포함 섹션: ${approved.length}개`,
    '',
    '---',
    '',
  ].join('\n');

  function injectSectionHeader(sec, body) {
    // Inject parent heading if section body doesn't start with "## NN."
    if (sec.title && /^\d{2}\./.test(sec.title) && !/^## \d{2}\./.test(body.trimStart())) {
      return `## ${sec.title}\n\n${body}`;
    }
    return body;
  }

  function numberRegionSubheadings(body) {
    let n = 0;
    return body.replace(/^### (.+)$/gm, (_m, title) => `## 05-${++n}. ${title}`);
  }

  const bodyParts = approved.map(s => {
    let b = normalizeMonthlyReportMarkdown(s.body);
    b = injectSectionHeader(s, b);
    if (s.id === 'region') b = numberRegionSubheadings(b);
    return normalizeMonthlyReportMarkdown(b);
  });
  const body = normalizeMonthlyReportMarkdown(bodyParts.join('\n\n---\n\n'));

  const footer = '\n';

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_PATH, header + body + footer, 'utf-8');

  console.log(`✅ 병합 완료: ${OUT_PATH}`);
  console.log(`   포함 섹션 (${approved.length}개): ${approved.map(s => s.id).join(', ')}`);
  if (skipped.length) {
    console.log(`   스킵 (${skipped.length}개):`);
    for (const s of skipped) console.log(`     ${s.id}: ${s.reason}`);
  }
  console.log('\n→ PDF 생성: node generators/report/monthly-report-pdf.js');
}

main();
