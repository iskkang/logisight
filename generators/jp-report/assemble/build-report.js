'use strict';
// generators/jp-report/assemble/build-report.js
// assembler — 마크다운 + 차트 + SEO 메타 → HTML.
// 사용법: node generators/jp-report/assemble/build-report.js [--period=2026-06]
//
// 발행(publish)은 별도 단계다. 이 단계는 산출물만 만든다 — 검수 결과에 따라
// 발행이 막힐 수 있으므로 조립과 발행을 섞지 않는다.

const fs = require('fs');
const path = require('path');
const { marked } = require('marked');

const { deriveTitle, deriveDescription, buildJsonLd, periodJa, SITE_NAME } = require('./seo');
const { sppiChart, portChart } = require('../image/charts');

const DRAFTS = path.resolve(__dirname, '../../../content/drafts');
const SITE_URL = process.env.JP_SITE_URL || 'https://jpn.logisight.net';

/** 차트를 해당 섹션 뒤에 끼워 넣는다. 섹션이 없으면 넣지 않는다(빈 그림이 남지 않게). */
function injectCharts(markdown, charts) {
  let out = markdown;
  for (const { afterSection, svgFile, alt } of charts) {
    const re = new RegExp(`(^#+\\s*${afterSection}\\.[\\s\\S]*?)(?=\\n---\\n|$)`, 'm');
    if (!re.test(out)) continue;
    out = out.replace(re, (m) => `${m}\n\n![${alt}](./${svgFile})\n`);
  }
  return out;
}

function buildHtml({ title, description, jsonLd, bodyHtml, period }) {
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<meta name="description" content="${description}">
<meta property="og:type" content="article">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${description}">
<meta property="og:site_name" content="${SITE_NAME}">
<link rel="canonical" href="${SITE_URL}/reports/${period}">
<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
<style>
body{font-family:"Hiragino Sans","Yu Gothic",Meiryo,sans-serif;line-height:1.85;color:#1a2433;
     max-width:760px;margin:0 auto;padding:32px 20px}
h1{font-size:24px;line-height:1.4;margin:0 0 24px}
h2{font-size:17px;margin:36px 0 12px;padding-top:20px;border-top:1px solid #e5e9f0}
p{margin:0 0 16px}
img{max-width:100%;height:auto;margin:20px 0}
hr{display:none}
.meta{font-size:12px;color:#828d9d;margin-bottom:28px}
table{width:100%;border-collapse:collapse;margin:18px 0;font-size:13px;line-height:1.5}
th,td{padding:7px 10px;border-bottom:1px solid #eef1f6;text-align:right}
th{background:#f7f9fc;font-weight:600;color:#4a5566;border-bottom:2px solid #cbd3de}
th:first-child,td:first-child{text-align:left}
/* 표 바로 뒤 단락은 출처·단위 주석(※)이다. 본문과 구분한다. */
table+p{font-size:12px;color:#828d9d;line-height:1.6;margin-top:-8px}
</style>
</head>
<body>
<h1>${title}</h1>
<div class="meta">${periodJa(period)} · ${SITE_NAME}</div>
${bodyHtml}
</body>
</html>`;
}

function assemble({ markdown, period, factsheet, publishedAt }) {
  const title = deriveTitle(markdown, period);
  const description = deriveDescription(markdown);
  const url = `${SITE_URL}/reports/${period}`;
  const jsonLd = buildJsonLd({ title, description, period, url, publishedAt });

  const charts = [
    { afterSection: '02', svgFile: `jp-chart-sppi-${period}.svg`, alt: '運賃指数 円ベースと契約通貨ベース', svg: sppiChart(factsheet) },
    { afterSection: '03', svgFile: `jp-chart-port-${period}.svg`, alt: '主要6港 前年同月比', svg: portChart(factsheet) },
  ];
  const withCharts = injectCharts(markdown, charts);
  // 첫 h2가 제목과 중복되지 않도록 총론 제목은 본문에서 h2로 남긴다(h1은 SEO 제목).
  const bodyHtml = marked.parse(withCharts);

  return { title, description, jsonLd, markdown: withCharts, charts, html: buildHtml({ title, description, jsonLd, bodyHtml, period }) };
}

function main() {
  const arg = (n, d) => {
    const f = process.argv.find((a) => a.startsWith(`--${n}=`));
    return f ? f.split('=').slice(1).join('=') : d;
  };
  const factsheet = JSON.parse(fs.readFileSync(path.join(DRAFTS, 'jp-factsheet.json'), 'utf8'));
  const period = arg('period', factsheet.generatedFor);
  const mdPath = path.join(DRAFTS, `jp-report-${period}.md`);
  if (!fs.existsSync(mdPath)) throw new Error(`원고 없음: ${mdPath} (writer를 먼저 실행)`);

  const markdown = fs.readFileSync(mdPath, 'utf8');
  const result = assemble({ markdown, period, factsheet, publishedAt: new Date().toISOString() });

  for (const c of result.charts) fs.writeFileSync(path.join(DRAFTS, c.svgFile), c.svg, 'utf8');
  const htmlPath = path.join(DRAFTS, `jp-report-${period}.html`);
  fs.writeFileSync(htmlPath, result.html, 'utf8');

  console.log('✅ 조립 완료');
  console.log(`   제목(${result.title.length}자): ${result.title}`);
  console.log(`   설명(${result.description.length}자): ${result.description}`);
  console.log(`   차트 ${result.charts.length}개, HTML ${(result.html.length / 1024).toFixed(1)}KB`);
  console.log(`   ${htmlPath}`);
}

if (require.main === module) {
  try { main(); } catch (e) { console.error('❌ 조립 실패:', e.message); process.exit(1); }
}

module.exports = { assemble, injectCharts, buildHtml };
