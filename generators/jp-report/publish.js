'use strict';
// generators/jp-report/publish.js
// 일본 월간 리포트 발행 — PDF를 스토리지에 올리고 reports 카탈로그에 등록한다.
// 사용법: node generators/jp-report/publish.js [--period=2026-06]
//
// reports 테이블은 한국판과 공유한다. lang='ja'를 반드시 박는다 —
// 안 박으면 기본값 'ko'가 되어 한국 사이트 목록에 일본 리포트가 뜬다.

const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env.local') });

const { publishReport } = require('../lib/publish-report');
const { buildPublishInput } = require('./lib/publish-input');

const DRAFTS = path.resolve(__dirname, '../../content/drafts');

async function main() {
  const arg = (n, d) => {
    const f = process.argv.find((a) => a.startsWith(`--${n}=`));
    return f ? f.split('=').slice(1).join('=') : d;
  };

  const factsheet = JSON.parse(fs.readFileSync(path.join(DRAFTS, 'jp-factsheet.json'), 'utf8'));
  const period = arg('period', factsheet.generatedFor);

  const mdPath = path.join(DRAFTS, `jp-report-${period}.md`);
  const pdfPath = path.join(DRAFTS, `jp-report-${period}.pdf`);
  for (const p of [mdPath, pdfPath]) {
    if (!fs.existsSync(p)) throw new Error(`산출물 없음: ${p} (run.js를 먼저 실행)`);
  }

  const input = buildPublishInput({
    period,
    markdown: fs.readFileSync(mdPath, 'utf8'),
    pdfPath,
  });

  console.log(`📤 일본 월간 리포트 발행 (${period})`);
  const { id, pdfUrl } = await publishReport(input);
  console.log(`   id=${id}`);
  console.log(`   ${pdfUrl}`);
  console.log(`   https://jpn.logisight.net/reports/monthly/${period}`);
}

if (require.main === module) {
  main().catch((e) => {
    console.error('❌ 발행 실패:', e.message);
    process.exit(1);
  });
}
