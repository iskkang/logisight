'use strict';
// RSS 후보 풀 빌더 — build-featured.js 에 고품질 후보 공급
// 1. config/news-feeds.json 로드
// 2. RSS 피드 병렬 수집·파싱 — HTTP 실패·파싱 0건 피드 자동 드롭
// 3. SeaSearch (shipshipship.uk) 보조 수집 — SEASEARCH_SESSION 없으면 스킵
// 4. 신선도(최근 45일) + 관련성(SCOPE_RE) 필터
// 5. 교차보도 클러스터링 (타이틀+요약 Jaccard ≥ 0.22 or 공유 토큰 ≥ 2)
// 6. 점수 = tier_weight × cross_report_multiplier × recency × relevance
// 7. outputs/cache/news-candidates.json 저장 (TTL 1일)

const path = require('path');
const fs   = require('fs');
const { XMLParser } = require('fast-xml-parser');

const FEEDS_PATH = path.resolve(__dirname, '../config/news-feeds.json');
const CACHE_PATH = path.resolve(__dirname, '../../../outputs/cache/news-candidates.json');
const CACHE_TTL  = 24 * 60 * 60 * 1000;      // 1 day
const WINDOW_MS  = 45 * 24 * 60 * 60 * 1000; // 45-day freshness window
const TOP_N      = 60;
const UA         = 'Mozilla/5.0 (compatible; LogisightBot/1.0)';

const SCOPE_RE = /freight|container|shipping|vessel|carrier|port|terminal|ocean|maritime|alliance|blank.?sailing|capacity|supply.?chain|SCFI|WCI|CCFI|BDI|TEU|FEU|drewry|alphaliner|MSC|Maersk|Hapag|COSCO|korea|asia|CIS|central.?asia|china|europe|suez|hormuz|운임|해운|컨테이너|항만|공급망|선복|중동|홍해/i;

const EN_STOP = new Set([
  'the','a','an','and','or','but','in','on','at','to','for','of','is','are','was','were',
  'has','have','had','will','would','could','should','with','from','by','as','be','this',
  'that','its','their','our','your','it','we','they','he','she','not','also','than','more',
  'new','says','said','over','after','before','report','news','latest','global','major',
  'key','amid','due','within','through','about','into','such','which','when','where',
  'year','week','month','day','time','data','show','rise','fall','rate','high','low',
]);

// ── Config & cache ────────────────────────────────────────────────────────────

function loadConfig() {
  return JSON.parse(fs.readFileSync(FEEDS_PATH, 'utf-8'));
}

function loadCache() {
  try {
    if (!fs.existsSync(CACHE_PATH)) return null;
    const raw = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf-8'));
    if (Date.now() - new Date(raw.fetched_at).getTime() > CACHE_TTL) return null;
    return raw;
  } catch (_) { return null; }
}

function saveCache(payload) {
  try {
    fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
    fs.writeFileSync(
      CACHE_PATH,
      JSON.stringify({ fetched_at: new Date().toISOString(), ...payload }, null, 2),
      'utf-8',
    );
  } catch (e) { console.warn('  rss-candidates: 캐시 저장 실패:', e.message); }
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────

async function fetchXml(url) {
  try {
    const r = await fetch(url, {
      headers: {
        'User-Agent': UA,
        Accept: 'application/rss+xml,application/atom+xml,application/xml,text/xml,*/*;q=0.8',
      },
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) return null;
    const ct = r.headers.get('content-type') || '';
    if (!ct.includes('xml') && !ct.includes('rss') && !ct.includes('atom') && !ct.includes('text')) return null;
    return await r.text();
  } catch (_) { return null; }
}

async function fetchJsonAuth(url, cookieStr) {
  try {
    const r = await fetch(url, {
      headers: {
        'User-Agent': UA,
        'Cookie':     cookieStr,
        'Accept':     'application/json',
      },
      signal: AbortSignal.timeout(12000),
    });
    if (!r.ok) return null;
    const ct = r.headers.get('content-type') || '';
    if (!ct.includes('json')) return null;
    return await r.json();
  } catch (_) { return null; }
}

// ── RSS/Atom parser ───────────────────────────────────────────────────────────

function extractLink(raw) {
  if (!raw) return '';
  if (Array.isArray(raw)) {
    const alt = raw.find(l => l['@_rel'] === 'alternate' || !l['@_rel']);
    return String(alt?.['@_href'] || raw[0]?.['@_href'] || raw[0] || '');
  }
  if (typeof raw === 'object') return String(raw['@_href'] || raw['#text'] || '');
  return String(raw);
}

function stripHtml(s) {
  return String(s || '').replace(/<!\[CDATA\[|\]\]>/g, '').replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ').trim();
}

function parseRSS(xml) {
  try {
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      parseTagValue: true,
      trimValues: true,
      isArray: (name) => name === 'item' || name === 'entry',
    });
    const obj = parser.parse(xml);
    const ch  = obj?.rss?.channel || obj?.feed;
    if (!ch) return [];
    const raw = ch.item || ch.entry || [];

    return raw.map(it => {
      const title   = stripHtml(it.title?.['#text'] || it.title || '').slice(0, 200);
      const link    = extractLink(it.link).trim();
      const summary = stripHtml(
        it.description?.['#text'] || it.description ||
        it.summary?.['#text']     || it.summary     ||
        it['content:encoded']     || '',
      ).slice(0, 500);
      const dateStr = String(it.pubDate || it.published || it.updated || it['dc:date'] || '');
      const pub     = dateStr ? new Date(dateStr) : null;
      return { title, link, summary, pub };
    }).filter(it => it.title.length > 5 && it.link.startsWith('http'));
  } catch (_) { return []; }
}

// ── SeaSearch integration ─────────────────────────────────────────────────────
// Requires SEASEARCH_SESSION env var (session cookie value from browser DevTools).
// Endpoint template is configurable in news-feeds.json seasearch.endpoint_tmpl.

async function fetchSeaSearch(config) {
  const raw = process.env.SEASEARCH_SESSION;
  if (!raw) return [];

  const ssConf = config.seasearch || {};
  if (!ssConf.enabled || !ssConf.endpoint_tmpl || !(ssConf.publications || []).length) return [];

  const cookieStr = raw.includes('=') ? raw : `session=${raw}`;
  const baseUrl   = (ssConf.base_url || 'https://shipshipship.uk').replace(/\/$/, '');
  const now       = Date.now();
  const results   = [];

  for (const pub of ssConf.publications) {
    const apiUrl = baseUrl + ssConf.endpoint_tmpl.replace('{pub_id}', pub.id);
    const data   = await fetchJsonAuth(apiUrl, cookieStr);
    if (!data) {
      console.warn(`  seasearch: ${pub.name} HTTP 실패 또는 JSON 아님 — 스킵`);
      continue;
    }

    const items = Array.isArray(data)
      ? data
      : (data.articles || data.data || data.results || data.items || []);

    let added = 0;
    for (const it of items) {
      const title   = stripHtml(it.title || it.headline || '').slice(0, 200);
      const url     = it.url || it.link || it.href || '';
      const summary = pub.headline_only
        ? ''
        : stripHtml(it.summary || it.description || it.excerpt || it.body || '').slice(0, 500);
      const dateStr = it.published_at || it.publishedAt || it.pub_date || it.date || it.created_at || '';
      const pubDate = dateStr ? new Date(dateStr) : null;

      if (!title || !url.startsWith('http')) continue;

      const validDate = pubDate instanceof Date && !isNaN(pubDate.getTime());
      const age       = validDate ? now - pubDate.getTime() : WINDOW_MS + 1;
      if (age > WINDOW_MS) continue;
      if (!SCOPE_RE.test(title + ' ' + summary)) continue;

      results.push({
        title,
        url,
        summary,
        source:   pub.name,
        tier:     pub.tier || 2,
        pub_date: validDate ? pubDate.toISOString().slice(0, 10) : '',
        age_days: Math.min(45, Math.round(Math.max(0, age) / 86400000)),
      });
      added++;
    }
    console.log(`  seasearch: ${pub.name} — ${added}건 통과`);
  }

  return results;
}

// ── Relevance scoring ─────────────────────────────────────────────────────────

function scoreRelevance(article, relKw) {
  if (!relKw) return 0.8;  // neutral if no config
  const text = (article.title + ' ' + (article.summary || '')).toLowerCase();

  const high   = (relKw.high   || []).filter(k => text.includes(k.toLowerCase())).length;
  const medium = (relKw.medium || []).filter(k => text.includes(k.toLowerCase())).length;
  const low    = (relKw.low    || []).filter(k => text.includes(k.toLowerCase())).length;

  const rel = 0.5
    + Math.min(high   * 0.20, 0.4)
    + Math.min(medium * 0.08, 0.16)
    + Math.min(low    * 0.04, 0.08);

  return Math.min(1.0, rel);
}

// ── Cross-report clustering ───────────────────────────────────────────────────

function tokenize(text) {
  return text.toLowerCase()
    .replace(/[^a-z0-9\s가-힣]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 3 && !EN_STOP.has(w));
}

function fingerprint(a) {
  return new Set(tokenize((a.title || '') + ' ' + (a.summary || '')).slice(0, 25));
}

function clusterBySource(articles) {
  const fps      = articles.map(a => fingerprint(a));
  const srcCount = new Array(articles.length).fill(1);
  const visited  = new Set();

  for (let i = 0; i < articles.length; i++) {
    if (visited.has(i)) continue;
    const group = [i];
    visited.add(i);

    for (let j = i + 1; j < articles.length; j++) {
      if (visited.has(j)) continue;
      const shared = [...fps[i]].filter(w => fps[j].has(w)).length;
      const total  = new Set([...fps[i], ...fps[j]]).size;
      if (shared >= 2 || (total > 0 && shared / total >= 0.22)) {
        group.push(j);
        visited.add(j);
      }
    }

    if (group.length > 1) {
      const distinct = new Set(group.map(k => articles[k].source)).size;
      for (const k of group) srcCount[k] = distinct;
    }
  }
  return srcCount;
}

// ── RSS collection (parallel) ─────────────────────────────────────────────────

async function collectRssFeeds(feeds, now) {
  const results = await Promise.allSettled(
    feeds.map(async feed => {
      const xml = await fetchXml(feed.url);
      if (!xml) {
        console.warn(`  rss: ${feed.name} HTTP 실패 — 드롭`);
        return [];
      }
      const items = parseRSS(xml);
      if (!items.length) {
        console.warn(`  rss: ${feed.name} 파싱 0건 — 드롭`);
        return [];
      }
      const batch = [];
      for (const it of items) {
        const validDate = it.pub instanceof Date && !isNaN(it.pub.getTime());
        const age       = validDate ? now - it.pub.getTime() : WINDOW_MS + 1;
        if (age > WINDOW_MS) continue;
        if (!SCOPE_RE.test(it.title + ' ' + it.summary)) continue;
        batch.push({
          title:    it.title,
          url:      it.link,
          summary:  it.summary,
          source:   feed.name,
          tier:     feed.tier,
          pub_date: validDate ? it.pub.toISOString().slice(0, 10) : '',
          age_days: Math.min(45, Math.round(Math.max(0, age) / 86400000)),
        });
      }
      console.log(`  rss: ${feed.name} — ${batch.length}건 통과`);
      return batch;
    }),
  );

  return results.flatMap(r => r.status === 'fulfilled' ? r.value : []);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function buildNewsCandidates({ force = false } = {}) {
  if (!force) {
    const cached = loadCache();
    if (cached) {
      console.log(
        '  rss-candidates: 캐시 사용 ('
        + cached.fetched_at.slice(0, 10) + ', '
        + (cached.candidates?.length || 0) + '건)',
      );
      return cached.candidates || null;
    }
  }

  const config = loadConfig();
  const tierW  = config.tier_weight             || {};
  const crMult = config.cross_report_multiplier || {};
  const relKw  = config.relevance_keywords      || null;
  const now    = Date.now();

  // Collect RSS and SeaSearch in parallel
  const [rssItems, ssItems] = await Promise.all([
    collectRssFeeds(config.feeds || [], now),
    fetchSeaSearch(config),
  ]);

  const ssCount = ssItems.length;
  if (ssCount) console.log(`  seasearch: 합계 ${ssCount}건`);

  // Merge; deduplicate by URL (SeaSearch wins on same URL for headline_only sources)
  const seen = new Set();
  const all  = [];
  for (const a of [...ssItems, ...rssItems]) {
    if (seen.has(a.url)) continue;
    seen.add(a.url);
    all.push(a);
  }

  if (!all.length) {
    console.warn('  rss-candidates: 전 피드 수집 0건');
    return null;
  }

  const srcCounts = clusterBySource(all);

  const scored = all.map((a, i) => {
    const tw  = parseFloat(tierW[String(a.tier)] || 0.6);
    const n   = srcCounts[i];
    const cm  = n >= 3 ? parseFloat(crMult['3'] || 1.5)
              : n >= 2 ? parseFloat(crMult['2'] || 1.2)
              : 1.0;
    const rec = Math.max(0.5, 1.0 - (a.age_days / 45) * 0.5);
    const rel = scoreRelevance(a, relKw);
    const score = Math.round(tw * cm * rec * rel * 1000) / 1000;
    return { ...a, source_count: n, score };
  });

  const uniq = new Set();
  const candidates = scored
    .sort((x, y) => y.score - x.score)
    .filter(a => { if (uniq.has(a.url)) return false; uniq.add(a.url); return true; })
    .slice(0, TOP_N);

  saveCache({ candidates });
  console.log(
    '  rss-candidates: 완료 — ' + candidates.length + '건'
    + (ssCount ? ` (SeaSearch ${ssCount}건 포함)` : ' (RSS-only)')
    + ', top score=' + (candidates[0]?.score ?? 0),
  );
  return candidates;
}

module.exports = { buildNewsCandidates, CACHE_PATH };
