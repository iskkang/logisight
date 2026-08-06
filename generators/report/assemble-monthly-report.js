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
const { resolveMonth } = require('./lib/report-month');

const TODAY    = new Date().toISOString().slice(0, 10);
const MONTH    = resolveMonth(process.argv.slice(2), new Date());

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

  // 본문이 스스로 제목을 달고 나오는 일이 있다. 레벨은 모델이 정하므로 # 일 수도 있다.
  // "## NN." 만 보던 기존 검사는 "# 01." 을 놓쳤고, 그 위에 하나를 더 붙여 제목이 둘이 됐다.
  // 제목이 둘이면 PDF가 섹션 표지를 두 장 찍는다 — 2026-08호 3·4쪽(01)과 19·20쪽(04)이 그랬다.
  // 앞머리의 번호 제목은 레벨을 가리지 않고 걷어낸 뒤, 정본 하나만 붙인다.
  // "02-1." 같은 소제목은 숫자 뒤가 마침표가 아니므로 걸리지 않는다.
  const OWN_SECTION_TITLE = /^#{1,3}[ \t]*\d{1,2}\.[ \t][^\n]*\n+/;

  function injectSectionHeader(sec, body) {
    if (!(sec.title && /^\d{2}\./.test(sec.title))) return body;
    return `## ${sec.title}\n\n${body.trimStart().replace(OWN_SECTION_TITLE, '')}`;
  }

  function numberRegionSubheadings(body) {
    let n = 0;
    // 제목이 이미 "05-N. "으로 시작하면 번호 재부여 없이 승격만 (중복 번호 방지)
    return body.replace(/^### (.+)$/gm, (_m, title) => {
      n++;
      const clean = title.replace(/^05-\d+\.\s*/, '');
      return `## 05-${n}. ${clean}`;
    });
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
