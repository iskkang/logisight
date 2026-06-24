'use strict';
// generators/weekly-report/approve-weekly-report.js
// 주간 리포트 승인 → PDF → 발행을 한 줄로. (크론이 만든 draft를 검수한 뒤 이걸 실행)
// status:draft → approved 로 바꾸고, PDF 생성(weekly-report-pdf), reports 발행(publish-weekly-report)을 순서대로 호출.
//
// 사용법:
//   node generators/weekly-report/approve-weekly-report.js --week=2026-W25
//   node generators/weekly-report/approve-weekly-report.js --week=2026-W25 --no-publish
//     --no-publish : 승인 + PDF 생성까지만(발행 전 PDF를 직접 열어 검토). 이후:
//                    npm run weekly-report:publish -- --week=2026-W25
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');

function arg(name) { const a = process.argv.find((x) => x.startsWith(`--${name}=`)); return a ? a.split('=')[1] : null; }
const hasFlag = (name) => process.argv.includes(`--${name}`);

function run(script, week) {
  execFileSync(process.execPath, [path.join(__dirname, script), `--week=${week}`], { stdio: 'inherit' });
}

function main() {
  const week = arg('week');
  if (!week || !/^\d{4}-W\d{2}$/.test(week)) throw new Error('--week=YYYY-Www 필요 (예: --week=2026-W25)');

  const src = path.join(ROOT, 'content/weekly-report', `${week}.md`);
  if (!fs.existsSync(src)) throw new Error(`초안 없음: ${src}`);

  // ① 프론트매터 status → approved (이미 approved면 그대로)
  let md = fs.readFileSync(src, 'utf-8');
  if (/^---[\s\S]*?\bstatus:\s*approved\b/.test(md)) {
    console.log(`ℹ️  이미 승인됨: ${week}`);
  } else if (/^---[\s\S]*?\bstatus:\s*\w+/.test(md)) {
    md = md.replace(/(^---[\s\S]*?\bstatus:\s*)\w+/, '$1approved');
    fs.writeFileSync(src, md);
    console.log(`✅ 승인: ${week} (status → approved)`);
  } else {
    throw new Error(`프론트매터에 status 필드가 없음: ${src}`);
  }

  // ② PDF 생성 (승인된 .md 필요 — 위에서 보장)
  console.log('— PDF 생성 …');
  run('weekly-report-pdf.js', week);

  if (hasFlag('no-publish')) {
    console.log(`\n⏸  --no-publish: PDF 검토 후 발행하려면 →  npm run weekly-report:publish -- --week=${week}`);
    return;
  }

  // ③ 발행 (Supabase reports 버킷 업로드 + weekly_reports/reports 카탈로그)
  console.log('— 발행 …');
  run('publish-weekly-report.js', week);

  console.log(`\n🎉 완료: ${week} — 승인 → PDF → 발행`);
}

main();
