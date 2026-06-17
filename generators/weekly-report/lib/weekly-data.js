// generators/weekly-report/lib/weekly-data.js
'use strict';
const fs = require('fs');
const path = require('path');
const SECTIONS = require('../sections.config');
const { buildOceanTable } = require('./ocean-table');
const { buildAirTable } = require('./air-table');
const { isoWeek, reportingPeriod } = require('./week');
const { loadIndexFactsheet } = require('../../report/lib/index-factsheet');

const ROOT = path.resolve(__dirname, '../../..');

// 섹션 → maritime_news.category (logisight-core와 동일 분류)
const SECTION_CATEGORY = { ocean: '해상', air: '항공', trade: '무역', logistics: '물류' };

function readJson(rel) {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf-8')); } catch { return null; }
}

function decodeEntities(s) {
  return String(s || '')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ');
}
// 제목·소제목: 한 줄로 정리
function inline(s) { return decodeEntities(s).replace(/\s+/g, ' ').trim(); }
// 본문: 문단 줄바꿈은 보존, 줄 내부 공백만 정리
function paragraphs(s) {
  return decodeEntities(s).replace(/\r/g, '').replace(/[ \t]+/g, ' ')
    .split('\n').map(x => x.trim()).filter(Boolean).join('\n').trim();
}

// maritime_news 행 → 기사 카드 데이터(카테고리·제목·소제목·이미지·본문)
function normalizeArticle(r) {
  let body = paragraphs(r.content || '');
  body = body.replace(/\n?\*?\s*출처\s*[:：][^\n]*\*?\s*$/, '').trim(); // 본문 끝 출처 줄 제거(별도 표기)
  if (body.length > 1000) body = body.slice(0, 1000).replace(/\s+\S*$/, '') + '…';
  return {
    category: r.category || '',
    title: inline(r.title),
    source: r.source || '',
    url: r.url || '',
    subtitle: inline(r.summary || ''),
    image: r.image_url || '',
    body,
  };
}

// 섹션 카테고리별 최근 7일 리치 기사(이미지+본문) 상위 3건. 내부 큐레이션(agent_type='brief') 우선.
async function loadSectionNews(supabase, catKo, sinceISO) {
  if (!supabase || !catKo) return [];
  const { data, error } = await supabase.from('maritime_news')
    .select('title,summary,content,image_url,source,url,category,agent_type,published_at')
    .eq('category', catKo).gte('published_at', sinceISO)
    .order('published_at', { ascending: false }).limit(60);
  if (error || !data) return [];
  // 이미지+본문 + 한국어 기사만(제목에 한글). 영문 외부 기사 제외.
  const rich = data.filter(r => r.image_url && (r.content || '').length > 200 && /[가-힣]/.test(r.title || ''));
  rich.sort((a, b) => (b.agent_type === 'brief' ? 1 : 0) - (a.agent_type === 'brief' ? 1 : 0));
  const seen = new Set();
  const out = [];
  for (const r of rich) {
    if (seen.has(r.title)) continue;
    seen.add(r.title);
    out.push(normalizeArticle(r));
    if (out.length >= 3) break;
  }
  return out;
}

async function assembleWeeklyData(supabase, now = new Date()) {
  const period = reportingPeriod(now);
  const weekId = isoWeek(now).id;
  const generatedAt = now.toISOString().slice(0, 10);
  const sinceISO = new Date(now.getTime() - 7 * 86400000).toISOString();

  const indexRows = supabase ? await loadIndexFactsheet().catch(() => null) : null;
  const iata = readJson('outputs/cache/iata-cargo.json');

  const sections = [];
  for (const sec of SECTIONS) {
    let table = null, factText = '';
    if (sec.table === 'ocean') ({ table, factText } = buildOceanTable(indexRows));
    else if (sec.table === 'air') ({ table, factText } = buildAirTable(iata));
    const news = await loadSectionNews(supabase, SECTION_CATEGORY[sec.id], sinceISO);
    sections.push({ id: sec.id, title: sec.title, table, factText, news });
  }

  return { weekId, period, generatedAt, sections };
}

module.exports = { assembleWeeklyData };
