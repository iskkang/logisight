'use strict';
const fs   = require('fs');
const path = require('path');

const NEWS_PATH = path.resolve(__dirname, '../../../content/drafts/latest-news.json');

function loadAllMonthlyItems() {
  if (!fs.existsSync(NEWS_PATH)) {
    console.error('ERROR: latest-news.json 없음 — npm run collect:monthly 먼저 실행하세요.');
    process.exit(1);
  }
  const data = JSON.parse(fs.readFileSync(NEWS_PATH, 'utf-8'));
  const all  = [
    ...(data.shipping || []),
    ...(data.rail     || []),
    ...(data.trade    || []),
  ].filter(i =>
    (i.category === 'deep_analysis' || i.category === 'carrier_update' || i.category === 'lane_causal') &&
    i.source && i.url && i.title && i.title.length >= 10
  );

  const seen = new Set();
  return all.filter(i => {
    if (seen.has(i.url)) return false;
    seen.add(i.url);
    return true;
  });
}

module.exports = { loadAllMonthlyItems };
