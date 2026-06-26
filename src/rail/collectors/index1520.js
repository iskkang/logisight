// index1520(UTLC ERA) 유라시아 철도 메타피드 → maritime_news category='철도'.
// progressive-railroading.js(category='철도-북미') 패턴 미러링. 공개 정적 HTML 목록만 파싱(로그인 X).
// 카드: div.container(중복 렌더 → url dedup), 메타 .row="News DD.MM.YYYY [source]", 내용 .row.columns(제목+리드).
const cheerio = require('cheerio');

const BASE = 'https://index1520.com';
const LIST_URL = `${BASE}/en/news/`;
const SOURCE_FALLBACK = 'index1520';
const CATEGORY = '철도'; // 철도 (유라시아)
const UA = 'LogisightRailMonitor/0.1 (+research)';

function cleanText(value) {
  return (value || '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
}

function parsePublishedAt(ddmmyyyy) {
  const m = String(ddmmyyyy || '').match(/(\d{2})\.(\d{2})\.(\d{4})/);
  if (!m) return null;
  const date = new Date(Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1])));
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

async function fetchText(url, fetchImpl) {
  const response = await fetchImpl(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'en' } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

// 목록 HTML → 기사 배열(url 기준 페이지 내 dedup).
function parseList(html) {
  const $ = cheerio.load(html);
  const byUrl = new Map();
  $('div.container').each((_, el) => {
    const $c = $(el);
    const a = $c
      .find('a[href*="/en/news/"]')
      .filter((__, x) => /\/en\/news\/[a-z0-9-]+\/?$/.test($(x).attr('href') || ''))
      .first();
    if (!a.length) return;
    if (!/\d{2}\.\d{2}\.\d{4}/.test($c.text())) return;

    const href = a.attr('href');
    const title = cleanText(a.text());
    if (!href || !title) return;
    const url = href.startsWith('http') ? href : BASE + href;

    const metaRow = cleanText($c.find('.row').first().text()); // "News DD.MM.YYYY [source]"
    const dateMatch = metaRow.match(/\d{2}\.\d{2}\.\d{4}/);
    const published_at = dateMatch ? parsePublishedAt(dateMatch[0]) : null;
    const source = dateMatch ? cleanText(metaRow.split(dateMatch[0])[1]) : '';

    const contentRow = cleanText($c.find('.row.columns').first().text());
    const summary = contentRow.startsWith(title) ? cleanText(contentRow.slice(title.length)) : '';

    const prev = byUrl.get(url);
    // 더 정보 많은 카드 유지(날짜/요약 채워진 쪽).
    if (!prev || (!prev.published_at && published_at) || (!prev.summary && summary)) {
      byUrl.set(url, { title, url, published_at, source: source || null, summary: summary || null });
    }
  });
  return [...byUrl.values()];
}

async function collectIndex1520({ supabase, fetchImpl = fetch } = {}) {
  const out = { source: 'index1520', read: 0, inserted: 0, errors: [] };
  if (!supabase) {
    out.errors.push('missing supabase client');
    return out;
  }

  let html;
  try {
    html = await fetchText(LIST_URL, fetchImpl);
  } catch (error) {
    out.errors.push(`list fetch: ${error.message}`);
    return out;
  }

  const items = parseList(html);
  out.read = items.length;
  if (!items.length) return out;

  const urls = items.map((item) => item.url);
  const { data: existing, error: existingError } = await supabase
    .from('maritime_news')
    .select('url')
    .in('url', urls);
  if (existingError) {
    out.errors.push(`existing read: ${JSON.stringify(existingError)}`);
    return out;
  }

  const seen = new Set((existing ?? []).map((row) => row.url));
  const fresh = items.filter((item) => !seen.has(item.url));
  const now = new Date().toISOString();
  const rows = fresh.map((item) => ({
    title: item.title,
    url: item.url,
    summary: item.summary,
    content: item.summary, // 목록 리드만 제공(본문 미보강) — 가짜 생성 X.
    source: item.source || SOURCE_FALLBACK,
    category: CATEGORY,
    lang: 'en',
    agent_type: 'external',
    is_hero: false,
    tags: ['rail', 'eurasia'],
    published_at: item.published_at,
    fetched_at: now,
  }));

  if (rows.length) {
    const { error } = await supabase.from('maritime_news').upsert(rows, { onConflict: 'url', ignoreDuplicates: false });
    if (error) {
      out.errors.push(`upsert: ${JSON.stringify(error)}`);
      return out;
    }
  }

  out.inserted = rows.length;
  return out;
}

module.exports = { collectIndex1520, LIST_URL, CATEGORY };
