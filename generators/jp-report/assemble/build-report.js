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
const {
  sppiChart, portChart, globalTrendChart, sppiTrendChart, tradeChart,
} = require('../image/charts');

const DRAFTS = path.resolve(__dirname, '../../../content/drafts');
const SITE_URL = process.env.JP_SITE_URL || 'https://jpn.logisight.net';

/**
 * どの図をどの節に置くか。節番号ではなくモードで決める — 番号は構成を変えるとずれる。
 * データが無ければ make が null を返し、その図は出さない(空枠を残さない)。
 */
const CHART_PLAN = [
  { section: '01', key: 'sppi', alt: '運賃指数 円ベースと契約通貨ベース', make: sppiChart },
  { section: '02', key: 'global-trend', alt: '世界のコンテナスポット指数 推移', make: globalTrendChart },
  { section: '02', key: 'sppi-ocean', alt: '外航貨物輸送 円・契約通貨ベース推移', make: (f) => sppiTrendChart(f, '外航貨物輸送') },
  { section: '03', key: 'sppi-air', alt: '国際航空貨物輸送 円・契約通貨ベース推移', make: (f) => sppiTrendChart(f, '国際航空貨物輸送') },
  { section: '05', key: 'port', alt: '主要6港 前年同月比', make: portChart },
  { section: '06', key: 'trade', alt: '主要相手国 輸出入額', make: tradeChart },
];

/** 節見出し。小見出し(## 02-1.)は数字のあとが '-' なので当たらない。 */
const SECTION_HEAD = /^#{1,3}\s*(\d{2})\.\s/;

/**
 * 図を節の末尾(次の節見出しの直前)に置く。
 * 節が無ければ入れない — 構成が変わったときに図だけ迷子で残るのを防ぐ。
 */
function injectCharts(markdown, charts) {
  const lines = markdown.split('\n');
  const heads = [];
  lines.forEach((l, i) => {
    const m = SECTION_HEAD.exec(l.trim());
    if (m) heads.push({ no: m[1], line: i });
  });

  const inserts = [];
  charts.forEach((c, idx) => {
    const k = heads.findIndex((h) => h.no === c.afterSection);
    if (k < 0) return;
    const end = k + 1 < heads.length ? heads[k + 1].line : lines.length;
    inserts.push({ at: end, idx, md: `\n![${c.alt}](./${c.svgFile})\n` });
  });

  // 뒤에서부터 넣어야 앞의 줄 번호가 밀리지 않는다.
  // 같은 자리에 여러 장이면 뒤에 정의된 것부터 넣어야 정의 순서대로 쌓인다.
  inserts.sort((a, b) => b.at - a.at || b.idx - a.idx);
  for (const ins of inserts) lines.splice(ins.at, 0, ins.md);
  return lines.join('\n');
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

  const charts = CHART_PLAN
    .map((c) => ({
      afterSection: c.section,
      svgFile: `jp-chart-${c.key}-${period}.svg`,
      alt: c.alt,
      svg: c.make(factsheet),
    }))
    .filter((c) => c.svg);
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
