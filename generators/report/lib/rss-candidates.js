'use strict';
// RSS + SeaSearch 후보 풀 빌더 — build-featured.js 에 고품질 후보 공급
//
// 수집 우선순위:
//   1. SeaSearch (shipshipship.uk) HTML 스크래핑 — 인증 불필요, 원문 링크 제공
//   2. RSS/Atom 피드 — SeaSearch 미커버 소스 보완
//
// 아티클 분류:
//   role=core  → 단독으로 대표 기사 pick 자격
//   role=net   → 교차보도 점수에만 기여; 단독(source_count=1)이면 pick 불가
//
// 점수 = tier_weight × cross_multiplier × recency × relevance
// 후보 파일: outputs/cache/news-candidates.json (TTL 1일)

const path = require('path');
const fs   = require('fs');
const { XMLParser } = require('fast-xml-parser');

const FEEDS_PATH = path.resolve(__dirname, '../config/news-feeds.json');
const CACHE_PATH = path.resolve(__dirname, '../../../outputs/cache/news-candidates.json');
const CACHE_TTL  = 24 * 60 * 60 * 1000;
const WINDOW_MS  = 45 * 24 * 60 * 60 * 1000;
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

// ── Domain map (built from feeds config) ─────────────────────────────────────

function buildDomainMap(feeds) {
  const map = {};
  for (const f of feeds) {
    if (!f.domain) continue;
    const key = f.domain.replace(/^www\./, '').toLowerCase();
    map[key] = { name: f.name, tier: f.tier, role: f.role || 'net', paywall: !!f.paywall };
  }
  return map;
}

function lookupDomain(url, domainMap) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '').toLowerCase();
    return domainMap[host] || null;
  } catch (_) { return null; }
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────

async function fetchXml(url) {
  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'application/rss+xml,application/atom+xml,text/xml,*/*;q=0.8' },
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) return null;
    return await r.text();
  } catch (_) { return null; }
}

async function fetchHtml(url) {
  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'text/html,*/*;q=0.8' },
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) return null;
    return await r.text();
  } catch (_) { return null; }
}

// ── HTML utilities ────────────────────────────────────────────────────────────

function stripHtml(s) {
  return String(s || '')
    .replace(/<!\[CDATA\[|\]\]>/g, '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ').trim();
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

function parseRSS(xml) {
  try {
    const parser = new XMLParser({
      ignoreAttributes: false, attributeNamePrefix: '@_',
      parseTagValue: true, trimValues: true,
      isArray: (name) => name === 'item' || name === 'entry',
    });
    const obj = parser.parse(xml);
    const ch  = obj?.rss?.channel || obj?.feed;
    if (!ch) return [];
    return (ch.item || ch.entry || []).map(it => {
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

// ── SeaSearch HTML scraper ────────────────────────────────────────────────────
// Two page layouts:
//   Publication pages (/publications/{id}/{slug}):
//     data-article-card boundary, <h3><a href>, <time datetime="ISO">, <p class="line-clamp-4">
//   Front page (/front-page):
//     <a target="_blank"><h4>TITLE</h4><span>N hours ago</span></a>

function parseRelativeTs(str, now) {
  if (/just\s*now/i.test(str)) return new Date(now - 60 * 1000);
  const norm  = str.replace(/\b(?:an?)\s+/gi, '1 ');
  let   total = 0;
  for (const part of norm.split(',')) {
    const m = part.trim().match(/^(\d+)\s+(minute|hour|day|week|month|year)/i);
    if (!m) continue;
    const n = parseInt(m[1], 10);
    switch (m[2][0].toLowerCase()) {
      case 'm': total += n * 60 * 1000;         break;
      case 'h': total += n * 3600 * 1000;       break;
      case 'd': total += n * 86400 * 1000;      break;
      case 'w': total += n * 7 * 86400 * 1000;  break;
      default:  total += m[2][0] === 'y' ? n * 365 * 86400 * 1000 : n * 30 * 86400 * 1000;
    }
  }
  return total > 0 ? new Date(now - total) : null;
}

function makeArticle(url, title, pubDate, summ, domainMap, now) {
  const validDate = pubDate instanceof Date && !isNaN(pubDate.getTime());
  const age       = validDate ? now - pubDate.getTime() : WINDOW_MS + 1;
  if (age > WINDOW_MS) return null;
  const info = lookupDomain(url, domainMap);
  return {
    title,
    url,
    summary:  summ,
    source:   info?.name  || new URL(url).hostname.replace(/^www\./, ''),
    tier:     info?.tier  || 3,
    role:     info?.role  || 'net',
    paywall:  !!(info?.paywall),
    pub_date: validDate ? pubDate.toISOString().slice(0, 10) : '',
    age_days: Math.min(45, Math.round(Math.max(0, age) / 86400000)),
  };
}

function parseSeaSearchHtml(html, domainMap, now) {
  // Publication pages: data-article-card + h3 + datetime ISO + line-clamp-4 summary
  if (html.includes('data-article-card')) {
    const articles = [];
    for (const card of html.split(/data-article-card/).slice(1)) {
      const linkM = card.match(/<h3[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>\s*<\/h3>/i);
      if (!linkM) continue;
      const url   = linkM[1].trim();
      const title = stripHtml(linkM[2]).trim().slice(0, 200);
      if (!title || title.length < 10 || !url.startsWith('http')) continue;

      const timeM = card.match(/datetime="([^"]+)"/i);
      const pub   = timeM ? new Date(timeM[1]) : null;

      const summM = card.match(/<p[^>]*line-clamp-4[^>]*>([\s\S]*?)<\/p>/i);
      const summ  = summM ? stripHtml(summM[1]).slice(0, 500) : '';

      const a = makeArticle(url, title, pub, summ, domainMap, now);
      if (a) articles.push(a);
    }
    return articles;
  }

  // Front page: <a target="_blank"><h4>TITLE</h4><span>N hours ago</span></a>
  const articles = [];
  const re = /<a[^>]+href="(https:\/\/[^"]+)"[^>]*target="_blank"[^>]*>\s*<h4[^>]*>([\s\S]*?)<\/h4>\s*<div[^>]*>\s*<i[^>]*><\/i>\s*<span>([^<]+)<\/span>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const url   = m[1].trim();
    const title = stripHtml(m[2]).trim().slice(0, 200);
    const ts    = m[3].trim();
    if (!title || title.length < 10) continue;
    const pub = parseRelativeTs(ts, now);
    const a   = makeArticle(url, title, pub, '', domainMap, now);
    if (a) articles.push(a);
  }
  return articles;
}

async function fetchSeaSearchPages(ssConf, domainMap, now) {
  if (!ssConf || !(ssConf.pages || []).length) return [];
  const baseUrl = (ssConf.base_url || 'https://www.shipshipship.uk').replace(/\/$/, '');

  const results = await Promise.allSettled(
    ssConf.pages.map(async pg => {
      const url  = baseUrl + pg.path;
      const html = await fetchHtml(url);
      if (!html) { console.warn('  seasearch: ' + url + ' 실패 — 드롭'); return []; }
      const items = parseSeaSearchHtml(html, domainMap, now)
        .filter(it => SCOPE_RE.test(it.title + ' ' + it.summary));
      console.log('  seasearch: ' + pg.path + ' — ' + items.length + '건 통과');
      return items;
    }),
  );

  return results.flatMap(r => r.status === 'fulfilled' ? r.value : []);
}

// ── RSS collection (parallel) ─────────────────────────────────────────────────

async function collectRssFeeds(feeds, domainMap, now) {
  const rssFeeds = feeds.filter(f => f.url);

  const results = await Promise.allSettled(
    rssFeeds.map(async feed => {
      const xml = await fetchXml(feed.url);
      if (!xml) { console.warn('  rss: ' + feed.name + ' HTTP 실패 — 드롭'); return []; }
      const items = parseRSS(xml);
      if (!items.length) { console.warn('  rss: ' + feed.name + ' 파싱 0건 — 드롭'); return []; }

      const batch = [];
      for (const it of items) {
        const validDate = it.pub instanceof Date && !isNaN(it.pub.getTime());
        const age       = validDate ? now - it.pub.getTime() : WINDOW_MS + 1;
        if (age > WINDOW_MS) continue;
        if (!SCOPE_RE.test(it.title + ' ' + it.summary)) continue;

        // Lookup domain to pick up authoritative role/tier in case feed url differs from domain
        const info = lookupDomain(it.link, domainMap);
        batch.push({
          title:    it.title,
          url:      it.link,
          summary:  it.summary,
          source:   info?.name  || feed.name,
          tier:     info?.tier  || feed.tier,
          role:     info?.role  || feed.role || 'net',
          paywall:  !!(info?.paywall || feed.paywall),
          pub_date: validDate ? it.pub.toISOString().slice(0, 10) : '',
          age_days: Math.min(45, Math.round(Math.max(0, age) / 86400000)),
        });
      }
      console.log('  rss: ' + feed.name + ' — ' + batch.length + '건 통과');
      return batch;
    }),
  );

  return results.flatMap(r => r.status === 'fulfilled' ? r.value : []);
}

// ── Relevance scoring ─────────────────────────────────────────────────────────

function scoreRelevance(article, relKw) {
  if (!relKw) return 0.8;
  const text = (article.title + ' ' + (article.summary || '')).toLowerCase();
  const high   = (relKw.high   || []).filter(k => text.includes(k.toLowerCase())).length;
  const medium = (relKw.medium || []).filter(k => text.includes(k.toLowerCase())).length;
  const low    = (relKw.low    || []).filter(k => text.includes(k.toLowerCase())).length;
  return Math.min(1.0,
    0.5 + Math.min(high * 0.20, 0.4) + Math.min(medium * 0.08, 0.16) + Math.min(low * 0.04, 0.08),
  );
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
        group.push(j); visited.add(j);
      }
    }
    if (group.length > 1) {
      const distinct = new Set(group.map(k => articles[k].source)).size;
      for (const k of group) srcCount[k] = distinct;
    }
  }
  return srcCount;
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

  const config    = loadConfig();
  const tierW     = config.tier_weight             || {};
  const crMult    = config.cross_report_multiplier || {};
  const relKw     = config.relevance_keywords      || null;
  const domainMap = buildDomainMap(config.feeds || []);
  const now       = Date.now();

  // Collect SeaSearch pages + RSS in parallel
  const [ssItems, rssItems] = await Promise.all([
    fetchSeaSearchPages(config.seasearch, domainMap, now),
    collectRssFeeds(config.feeds || [], domainMap, now),
  ]);

  const ssCount = ssItems.length;
  if (ssCount) console.log('  seasearch: 합계 ' + ssCount + '건');

  // Merge; SeaSearch wins dedup (paywall sources get headline-only entry from SeaSearch)
  const seen = new Set();
  const all  = [];
  for (const a of [...ssItems, ...rssItems]) {
    if (seen.has(a.url)) continue;
    seen.add(a.url);
    all.push(a);
  }

  if (!all.length) { console.warn('  rss-candidates: 전 소스 수집 0건'); return null; }

  const srcCounts = clusterBySource(all);

  const scored = all.map((a, i) => {
    const tw   = parseFloat(tierW[String(a.tier)]  || 0.6);
    const n    = srcCounts[i];
    const cm   = n >= 3 ? parseFloat(crMult['3'] || 1.5)
               : n >= 2 ? parseFloat(crMult['2'] || 1.2) : 1.0;
    const rec  = Math.max(0.5, 1.0 - (a.age_days / 45) * 0.5);
    const rel  = scoreRelevance(a, relKw);
    const score = Math.round(tw * cm * rec * rel * 1000) / 1000;

    // pick_eligible: core 단독 또는 교차보도 ≥ 2매체
    const is_core      = a.role === 'core';
    const pick_eligible = is_core || n >= 2;

    return { ...a, source_count: n, score, is_core, pick_eligible };
  });

  const uniq = new Set();
  const candidates = scored
    .sort((x, y) => y.score - x.score)
    .filter(a => { if (uniq.has(a.url)) return false; uniq.add(a.url); return true; })
    .slice(0, TOP_N);

  saveCache({ candidates });

  const pickable = candidates.filter(c => c.pick_eligible).length;
  console.log(
    '  rss-candidates: 완료 — ' + candidates.length + '건'
    + (ssCount ? ' (SeaSearch ' + ssCount + '건 포함)' : ' (RSS-only)')
    + ', pick_eligible=' + pickable
    + ', top score=' + (candidates[0]?.score ?? 0),
  );
  return candidates;
}

module.exports = { buildNewsCandidates, CACHE_PATH };
