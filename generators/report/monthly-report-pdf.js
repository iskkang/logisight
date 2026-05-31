'use strict';
// generators/report/monthly-report-pdf.js
// 월간 리포트 마크다운 → PDF 변환
// 사용법:
//   node monthly-report-pdf.js
//   node monthly-report-pdf.js --month=2026-04

const fs        = require('fs');
const path      = require('path');
const { marked } = require('marked');
const puppeteer = require('puppeteer-core');

const TODAY    = new Date().toISOString().slice(0, 10);
const monthArg = process.argv.find(a => a.startsWith('--month='));
const MONTH    = monthArg ? monthArg.split('=')[1] : TODAY.slice(0, 7);

const MD_PATH  = path.resolve(__dirname, `../../content/drafts/monthly-analysis-${MONTH}.md`);
const OUT_DIR  = path.resolve(__dirname, '../../content/published');
const OUT_PATH = path.join(OUT_DIR, `monthly-analysis-${MONTH}.pdf`);

function loadMarkdown() {
  if (!fs.existsSync(MD_PATH)) {
    console.error(`ERROR: ${MD_PATH} 없음`);
    console.error('먼저 실행하세요: node generators/report/assemble-monthly-report.js');
    process.exit(1);
  }
  return fs.readFileSync(MD_PATH, 'utf-8')
    .replace(/<!--[\s\S]*?-->/g, '')
    .trim();
}

function buildHtml(mdContent) {
  const bodyHtml = marked.parse(mdContent);

  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@300;400;500;700;900&display=swap" rel="stylesheet">
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
@page{size:A4;margin:18mm 20mm 14mm}
body{font-family:'Noto Sans KR',sans-serif;background:#fff;color:#1a1a2e;font-size:10pt;line-height:1.7}

/* ── Report header strip ── */
.rh{
  background:linear-gradient(90deg,#1E3A5F 0%,#2E86AB 100%);
  color:#fff;padding:3.5mm 6mm;margin:-18mm -20mm 10mm;
  display:flex;justify-content:space-between;align-items:center
}
.rh-logo{font-weight:900;font-size:11pt;letter-spacing:2px}
.rh-meta{font-size:8pt;opacity:0.8}

/* ── Typography ── */
h1{font-size:17pt;font-weight:900;color:#1E3A5F;margin:0 0 7mm;
   padding-bottom:2.5mm;border-bottom:3px solid #2E86AB}
h2{font-size:12.5pt;font-weight:700;color:#1E3A5F;margin:8mm 0 3mm;
   padding-bottom:1.5mm;border-bottom:2px solid #2E86AB;display:inline-block}
h3{font-size:10.5pt;font-weight:700;color:#2E86AB;margin:5mm 0 2mm}
p{font-size:9.5pt;line-height:1.85;color:#2c3e50;margin-bottom:3mm}
ul,ol{padding-left:5mm;margin-bottom:3mm}
li{font-size:9pt;line-height:1.75;color:#2c3e50;margin-bottom:1mm}
strong{color:#1E3A5F;font-weight:700}
blockquote{
  background:#EBF4FA;border-left:3.5px solid #2E86AB;
  border-radius:0 6px 6px 0;padding:3mm 5mm;
  margin:4mm 0;font-size:9.5pt;color:#1E3A5F;font-weight:600
}
hr{border:none;border-top:0.5px solid #d0d7e0;margin:6mm 0;page-break-after:avoid}
code{background:#f0f4f8;color:#1E3A5F;padding:0.5mm 2mm;border-radius:3px;font-size:8.5pt}

/* ── Section header block ── */
h2{page-break-before:auto;page-break-after:avoid}
h3{page-break-after:avoid}

/* ── Callout (blockquote 재활용) ── */
blockquote p{margin:0;font-size:9.5pt}

/* ── Footer text ── */
p:last-child em,p:last-child{font-size:8pt;color:#8899aa}
</style>
</head>
<body>
<div class="rh">
  <div class="rh-logo">LOGISIGHT</div>
  <div class="rh-meta">월간 시장 인텔리전스 &nbsp;·&nbsp; ${MONTH} &nbsp;·&nbsp; MTL Shipping Agency</div>
</div>
${bodyHtml}
</body>
</html>`;
}

async function main() {
  console.log(`⏳ ${MONTH} 월간 리포트 PDF 생성 중...`);
  const md   = loadMarkdown();
  const html = buildHtml(md);

  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--font-render-hinting=none',
    ],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 794, height: 1123, deviceScaleFactor: 1 });
    console.log('⏳ 페이지 로드 중 (Noto Sans KR CDN)...');
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 30000 });

    fs.mkdirSync(OUT_DIR, { recursive: true });
    await page.pdf({
      path:            OUT_PATH,
      format:          'A4',
      printBackground: true,
      margin: { top: '18mm', right: '20mm', bottom: '14mm', left: '20mm' },
    });
    console.log(`✅ PDF 완료: ${OUT_PATH}`);
  } finally {
    await browser.close();
  }
}

main().catch(err => {
  console.error('❌ monthly-report-pdf.js 실패:', err.message);
  process.exit(1);
});
