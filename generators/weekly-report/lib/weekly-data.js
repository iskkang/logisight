// generators/weekly-report/lib/weekly-data.js
'use strict';
const fs = require('fs');
const path = require('path');
const SECTIONS = require('../sections.config');
const { filterNews } = require('./news-filter');
const { buildOceanTable } = require('./ocean-table');
const { buildAirTable } = require('./air-table');
const { isoWeek, reportingPeriod } = require('./week');
const { loadIndexFactsheet } = require('../../report/lib/index-factsheet');

const ROOT = path.resolve(__dirname, '../../..');

function readJson(rel) {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf-8')); } catch { return null; }
}

// latest-news.json -> 섹션 키워드 입력용 통합 풀
function newsPool(news) {
  return [
    ...(news.shipping || []), ...(news.air || []), ...(news.rail || []),
    ...(news.trade || []), ...(news.risk || []), ...(news.carrier_advisory || []),
    ...(news.logistics || []),
  ];
}

async function assembleWeeklyData(supabase, now = new Date()) {
  const period = reportingPeriod(now);
  const weekId = isoWeek(now).id;
  const generatedAt = now.toISOString().slice(0, 10);

  const indexRows = supabase ? await loadIndexFactsheet().catch(() => null) : null;
  const iata = readJson('outputs/cache/iata-cargo.json');
  const news = readJson('content/drafts/latest-news.json') || {};
  const pool = newsPool(news);

  const sections = SECTIONS.map(sec => {
    let table = null, factText = '';
    if (sec.table === 'ocean') ({ table, factText } = buildOceanTable(indexRows));
    else if (sec.table === 'air') ({ table, factText } = buildAirTable(iata));
    const newsItems = filterNews(pool, sec.keywords, now, 7, 8)
      .map(n => ({ title: n.title, source: n.source }));
    return { id: sec.id, title: sec.title, table, factText, news: newsItems };
  });

  return { weekId, period, generatedAt, sections };
}

module.exports = { assembleWeeklyData };
