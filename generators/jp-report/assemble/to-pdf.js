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
const { buildMagazineHtml, dividerHtml } = require('./magazine');
const { outputOrder } = require('../write/sections');

const DRAFTS = path.resolve(__dirname, '../../../content/drafts');

const CHROME = process.env.PUPPETEER_EXECUTABLE_PATH
  || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

/**
 * 마크다운 이미지 참조를 SVG 본문으로 치환한다.
 * 캡션은 붙이지 않는다 — SVG가 제목と副題(基準日・単位)を持っており、alt を重ねると
 * ほぼ同じ文が二度出る。alt はウェブ版の <img> 用に残す。
 */
function inlineCharts(html, charts) {
  let out = html;
  for (const c of charts) {
    const re = new RegExp(`<img[^>]*src="\\./${c.svgFile.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*>`, 'g');
    out = out.replace(re, `<figure>${c.svg}</figure>`);
  }
  return out;
}

/**
 * ウェブ用の見出しを落とす。
 * 表紙が題名と発行日を持つため、本文先頭の <h1> と .meta は重複でしかない。
 * 残すと、その2行だけで丸ごと1ページを使う。
 */
function stripWebHeader(html) {
  return html
    .replace(/<h1[^>]*>[\s\S]*?<\/h1>\s*/i, '')
    .replace(/<div class="meta">[\s\S]*?<\/div>\s*/i, '');
}

/** 各セクション見出し(<h2>01. …)の直前に扉ページを挟む。 */
function insertDividers(html) {
  let out = html;
  for (const s of outputOrder()) {
    const re = new RegExp(`<h2[^>]*>\s*${s.no}\.[^<]*</h2>`);
    const hit = re.exec(out);
    if (!hit) continue;
    out = out.slice(0, hit.index) + dividerHtml(s) + out.slice(hit.index);
  }
  return out;
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

  // 韓国版と同じ雑誌組版にする — 表紙・Executive Summary・セクション扉・裏表紙。
  // built.html は <html> 一式なので、本文(<body>内)だけを取り出して差し込む。
  const inner = inlineCharts(built.html, built.charts);
  const m = /<body[^>]*>([\s\S]*?)<\/body>/i.exec(inner);
  const bodyOnly = m ? m[1] : inner;
  // セクション扉を各セクションの直前に挟む。見出し番号で位置を決める。
  const withDividers = insertDividers(stripWebHeader(bodyOnly));
  const body = buildMagazineHtml({
    bodyHtml: withDividers,
    facts: factsheet,
    period,
    publishedAt: new Date().toISOString().slice(0, 10),
  });

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
      // 表紙・扉は全面塗りなので余白ゼロ。本文の余白は CSS の @page で持たせる。
      margin: { top: '0', bottom: '0', left: '0', right: '0' },
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

module.exports = { inlineCharts, insertDividers, stripWebHeader };
