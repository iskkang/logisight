'use strict';
// generators/report/publish-monthly-report.js
// 월간 리포트 발행 — content/published/monthly-analysis-<month>.pdf 를 reports 버킷에
// 업로드하고 public.reports 카탈로그에 등록한다. (게이트 = PDF 존재)
// 사용법: node generators/report/publish-monthly-report.js [--month=2026-06]
//   먼저 PDF 생성: npm run monthly:pdf -- --month=2026-06
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env.local') });
const { publishReport } = require('../lib/publish-report');

const ROOT = path.resolve(__dirname, '../..');

function arg(name) { const a = process.argv.find(x => x.startsWith(`--${name}=`)); return a ? a.split('=')[1] : null; }

async function main() {
  const month = arg('month') || new Date().toISOString().slice(0, 7); // YYYY-MM
  const [yy, mm] = month.split('-').map(Number);
  if (!yy || !mm || mm < 1 || mm > 12) throw new Error('--month=YYYY-MM 형식 필요');

  const pdfPath = path.join(ROOT, 'content/published', `monthly-analysis-${month}.pdf`);
  if (!fs.existsSync(pdfPath)) {
    throw new Error(`PDF 없음: ${pdfPath}\n먼저 실행: npm run monthly:pdf -- --month=${month}`);
  }

  const periodStart = `${month}-01`;
  const lastDay = new Date(yy, mm, 0).getDate();           // 해당 월 말일
  const periodEnd = `${month}-${String(lastDay).padStart(2, '0')}`;

  await publishReport({
    type: 'monthly',
    periodStart,
    periodEnd,
    periodLabel: `${yy}년 ${mm}월호`,
    title: `월간 시장 인텔리전스 리포트 · ${mm}월호`,
    summary: '글로벌 해운·항공·철도 운임과 공급망·지정학 동향 종합 분석',
    pdfPath,
    webUrl: null,
    // 분류(048): 월간
    reportClass: 'monthly',
    region: null,
    isoWeek: null,
  });
  console.log(`✅ 월간 발행 완료: ${month}`);
}

main().catch(e => { console.error('발행 실패:', e.message); process.exit(1); });
