'use strict';
// 승인된 주간 리포트 마크다운 -> A4 PDF.
// 사용법: node generators/weekly-report/weekly-report-pdf.js --week=2026-W24
const fs = require('fs');
const path = require('path');
const { marked } = require('marked');
const puppeteer = require('puppeteer-core');

const ROOT = path.resolve(__dirname, '../..');
const weekArg = process.argv.find(a => a.startsWith('--week='));

function stripFrontmatter(md) {
  return md.replace(/^---[\s\S]*?---\s*/, '');
}

// monthly-report-pdf.js 와 동일한 Chrome 실행경로 해석을 사용한다.
function chromePath() {
  return 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
}

async function main() {
  if (!weekArg) throw new Error('--week=YYYY-Www 필요');
  const week = weekArg.split('=')[1];
  const src = path.join(ROOT, 'content/weekly-report', `${week}.md`);
  const md = fs.readFileSync(src, 'utf-8');
  if (!/status:\s*approved/.test(md)) throw new Error(`승인되지 않음(status: approved 아님): ${src}`);

  const html = `<!doctype html><html><head><meta charset="utf-8">
<style>
  @page { size: A4; margin: 18mm 16mm; }
  body { font-family: 'Pretendard','Malgun Gothic',sans-serif; font-size: 11pt; color: #222; line-height: 1.5; }
  h1 { font-size: 20pt; border-bottom: 2px solid #0070C0; padding-bottom: 6px; }
  h2 { font-size: 14pt; color: #0070C0; margin-top: 18px; }
  h3 { font-size: 12pt; margin-top: 12px; }
  table { border-collapse: collapse; width: 100%; margin: 8px 0; font-size: 10pt; }
  th,td { border: 1px solid #bbb; padding: 4px 8px; text-align: left; }
  th { background: #eef3f8; }
  blockquote { color: #666; font-size: 9.5pt; border-left: 3px solid #ccc; margin: 6px 0; padding-left: 8px; }
</style></head><body>${marked.parse(stripFrontmatter(md))}</body></html>`;

  const outDir = path.join(ROOT, 'content/published');
  fs.mkdirSync(outDir, { recursive: true });
  const out = path.join(outDir, `weekly-report-${week}.pdf`);

  const browser = await puppeteer.launch({ executablePath: chromePath(), headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'networkidle0' });
  await page.pdf({ path: out, format: 'A4', printBackground: true });
  await browser.close();
  console.log(`✅ PDF: ${out}`);
}

main().catch(e => { console.error('PDF 생성 실패:', e.message); process.exit(1); });
