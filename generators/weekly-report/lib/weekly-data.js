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

// HTML 엔티티 디코드(제목·본문에 &#8216; 등 잔존) + 공백 정리
function clean(s) {
  return String(s || '')
    .replace(/&#x?([0-9a-f]+);/gi, (_, c) => String.fromCharCode(/^x/i.test('x' + c) ? parseInt(c, 16) : parseInt(c, 10)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

// 뉴스 항목 정규화: 제목·소제목·이미지·본문. 이미지+본문 있는 항목 우선 정렬용 점수.
function normalizeNews(n) {
  const body = clean(n.content || '');
  return {
    title: clean(n.title),
    source: n.source || '',
    url: n.url || '',
    subtitle: clean(n.summary_en || ''),
    image: n.og_image || '',
    body: body.length > 360 ? body.slice(0, 360).replace(/\s+\S*$/, '') + '…' : body,
  };
}
function richScore(n) { return (n.image ? 2 : 0) + (n.body ? 1 : 0); }

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
    // 키워드 매칭 후, 이미지+본문 있는 항목을 우선해 상위 3건을 카드용으로 확보.
    const newsItems = filterNews(pool, sec.keywords, now, 7, 12)
      .map(normalizeNews)
      .sort((a, b) => richScore(b) - richScore(a))
      .slice(0, 3);
    return { id: sec.id, title: sec.title, table, factText, news: newsItems };
  });

  return { weekId, period, generatedAt, sections };
}

module.exports = { assembleWeeklyData };
