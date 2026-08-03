'use strict';
// generators/jp-report/assemble/to-pdf.js
// 조립된 리포트를 PDF로 렌더한다.
// 사용법: node generators/jp-report/assemble/to-pdf.js [--period=2026-06]
//
// 차트는 파일 참조가 아니라 SVG를 본문에 인라인한다 — setContent는 상대경로를
// 해석하지 못해 이미지가 빈 칸으로 나온다.

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env.local') });

const { assemble } = require('./build-report');
const { periodJa, SITE_NAME } = require('./seo');

const DRAFTS = path.resolve(__dirname, '../../../content/drafts');

const CHROME = process.env.PUPPETEER_EXECUTABLE_PATH
  || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

/** 마크다운 이미지 참조를 SVG 본문으로 치환한다. */
function inlineCharts(html, charts) {
  let out = html;
  for (const c of charts) {
    const re = new RegExp(`<img[^>]*src="\\./${c.svgFile.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*>`, 'g');
    out = out.replace(re, `<figure>${c.svg}<figcaption>${c.alt}</figcaption></figure>`);
  }
  return out;
}

function printCss() {
  return `
@page { size: A4; margin: 18mm 16mm 20mm; }
body { font-family:"Hiragino Sans","Yu Gothic",Meiryo,sans-serif; font-size:10.5pt; line-height:1.9;
       color:#1a2433; max-width:none; margin:0; padding:0 }
h1 { font-size:19pt; line-height:1.45; margin:0 0 10mm; border-bottom:2px solid #1B4D8C; padding-bottom:5mm }
h2 { font-size:12.5pt; margin:9mm 0 4mm; padding-top:4mm; border-top:1px solid #e5e9f0;
     break-after:avoid; page-break-after:avoid }
p { margin:0 0 4mm; text-align:justify }
figure { margin:6mm 0; break-inside:avoid; page-break-inside:avoid; text-align:center }
figure svg { max-width:100%; height:auto }
figcaption { font-size:8.5pt; color:#828d9d; margin-top:2mm }
.meta { font-size:9pt; color:#828d9d; margin-bottom:8mm }
hr { display:none }
`;
}

async function main() {
  const arg = (n, d) => {
    const f = process.argv.find((a) => a.startsWith(`--${n}=`));
    return f ? f.split('=').slice(1).join('=') : d;
  };
  const factsheet = JSON.parse(fs.readFileSync(path.join(DRAFTS, 'jp-factsheet.json'), 'utf8'));
  const period = arg('period', factsheet.generatedFor);
  const mdPath = path.join(DRAFTS, `jp-report-${period}.md`);
  if (!fs.existsSync(mdPath)) throw new Error(`원고 없음: ${mdPath}`);

  const markdown = fs.readFileSync(mdPath, 'utf8');
  const built = assemble({ markdown, period, factsheet, publishedAt: new Date().toISOString() });

  const body = inlineCharts(built.html, built.charts)
    .replace('</style>', `${printCss()}</style>`);

  const outPath = path.join(DRAFTS, `jp-report-${period}.pdf`);
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu',
      '--font-render-hinting=none'],
  });
  try {
    const page = await browser.newPage();
    await page.setContent(body, { waitUntil: 'load', timeout: 30000 });
    await page.pdf({
      path: outPath,
      format: 'A4',
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: '<div></div>',
      footerTemplate:
        `<div style="width:100%;font-size:8pt;color:#828d9d;padding:0 16mm;display:flex;justify-content:space-between">
           <span>${SITE_NAME} · ${periodJa(period)} 物流市況レポート</span>
           <span class="pageNumber"></span></div>`,
      margin: { top: '18mm', bottom: '20mm', left: '16mm', right: '16mm' },
    });
  } finally {
    await browser.close();
  }

  const kb = (fs.statSync(outPath).size / 1024).toFixed(0);
  console.log(`✅ PDF: ${outPath} (${kb}KB)`);
  console.log(`   제목: ${built.title}`);
}

if (require.main === module) {
  main().catch((e) => { console.error('❌ PDF 생성 실패:', e.message); process.exit(1); });
}

module.exports = { inlineCharts };
