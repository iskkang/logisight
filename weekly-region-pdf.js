'use strict';
// 권역 위클리 standalone PDF 렌더러. content/weekly-region/<week>-<region>.json → 테마(복제) → A4 PDF.
// weekly-report 무수정 — 테마는 lib/weekly-region-theme.js 사용.
// 사용법: node weekly-region-pdf.js --week=2026-W26 --region=europe
const fs = require('fs');
const path = require('path');
const META = require('./config/region-meta');
const { adapt } = require('./lib/weekly-region-adapter');
const { buildRegionHtml, renderPdf } = require('./lib/weekly-region-theme');

const arg = (n) => { const a = process.argv.find((x) => x.startsWith(`--${n}=`)); return a ? a.split('=')[1] : null; };

async function main() {
  const region = arg('region'); const week = arg('week');
  if (!region || !week) throw new Error('--week=YYYY-Www --region=<key> 필요');
  const meta = META[region];
  if (!meta) throw new Error(`region-meta 없음: ${region}`);

  const jsonPath = path.join(__dirname, 'content/weekly-region', `${week}-${region}.json`);
  if (!fs.existsSync(jsonPath)) throw new Error(`feed JSON 없음: ${jsonPath} (먼저 weekly-region-feed.js 실행)`);
  const json = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));

  const model = adapt(json, meta);
  if (!model.blocks.length && !model.summary) { console.warn(`⚠️ [${region}] 렌더할 블록 없음 — 생략`); return; }

  const html = buildRegionHtml(model);
  const outDir = path.join(__dirname, 'content/published');
  fs.mkdirSync(outDir, { recursive: true });
  const out = path.join(outDir, `weekly-report-${week}-${region}.pdf`);
  await renderPdf(html, out);
  console.log(`✅ [${region}] PDF: ${out} (blocks ${model.blocks.length}, items ${model.blocks.reduce((n, b) => n + b.items.length, 0)})`);
}

main().catch((e) => { console.error('PDF 생성 실패:', e.message); process.exit(1); });
