'use strict';
// Rail quantitative data — Landbridge.com (中欧班列·国境通过量·中俄物流)
//
// Scrapes Landbridge list pages → filters to current report month →
// fetches detail pages for statistics (편수/물동량/货值/YoY/운임) →
// builds table + factText for LLM.
//
// B-2 congestion gating: only sets hasCongestion=true if articles from
// the target MONTH contain congestion keywords (拥堵·积压·滞留·排队 등).
//
// Cache: outputs/cache/rail-index-YYYY-MM.json  (24h TTL)

const path = require('path');
const fs   = require('fs');
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env.local') });

const CACHE_DIR = path.resolve(__dirname, '../../../outputs/cache');

const BOT_HEADERS = {
  'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Accept':          'text/html,application/xhtml+xml,*/*;q=0.8',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
};

const LANDBRIDGE_SOURCES = [
  { url: 'http://www.landbridge.com/yaowen/',     name: '中欧班列',   priority: 'main'      },
  { url: 'http://www.landbridge.com/kouan/',      name: '국경통과량', priority: 'main'      },
  { url: 'http://www.landbridge.com/russiainfo/', name: '中俄물류',   priority: 'main'      },
  { url: 'http://www.landbridge.com/silkroad/',   name: '일대일로',   priority: 'secondary' },
  { url: 'http://www.landbridge.com/cis/',        name: 'CIS',        priority: 'secondary' },
];

// B-2 congestion keywords — at least one must appear in current-month article
const CONGESTION_KW = ['拥堵', '积压', '滞留', '排队', '停装', '换装能力', '车板', '满负荷', '通关延误'];

// ── HTTP ──────────────────────────────────────────────────────────────────────

async function fetchPage(url) {
  try {
    const r = await fetch(url, {
      headers: BOT_HEADERS,
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) return null;
    return await r.text();
  } catch (_) { return null; }
}

function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

// ── Article link extraction ───────────────────────────────────────────────────
// Landbridge URL pattern: /section/YYYY-MM-DD/NNNNN.html

function extractArticleLinks(html, baseUrl, month) {
  if (!html) return [];
  const origin = new URL(baseUrl).origin;
  const seen   = new Set();
  const items  = [];

  // Primary: links with date in URL path
  const dateInPathRe = /href="([^"]*\/(\d{4}-\d{2}-\d{2})\/\d+\.html)"[^>]*>([^<]{4,120})</gi;
  for (const m of html.matchAll(dateInPathRe)) {
    let href   = m[1];
    const date = m[2];
    const title = m[3].trim().replace(/\s+/g, ' ');
    if (!href.startsWith('http')) href = origin + (href.startsWith('/') ? href : '/' + href);
    if (month && !date.startsWith(month)) continue;
    if (!title || seen.has(href)) continue;
    seen.add(href);
    items.push({ href, date, title });
    if (items.length >= 12) break;
  }

  // Fallback: any links mentioning the month in URL
  if (!items.length) {
    const fallRe = new RegExp(`href="([^"]*${month}[^"]*\\.html)"[^>]*>([^<]{4,120})<`, 'gi');
    for (const m of html.matchAll(fallRe)) {
      let href  = m[1];
      const title = m[2].trim();
      if (!href.startsWith('http')) href = origin + href;
      if (!title || seen.has(href)) continue;
      seen.add(href);
      items.push({ href, date: month, title });
      if (items.length >= 8) break;
    }
  }

  return items;
}

// ── Statistics parser (Chinese text) ─────────────────────────────────────────

function extractStats(text) {
  const s = {};

  // 편수 (列/趟)
  //
  // 万 을 먼저 본다. TEU 쪽은 万 을 처리하는데 편수 쪽만 빠져 있었다.
  // 「新疆双口岸今年通行中欧班列超万列」(1만 편 초과)에서 숫자가 없어
  // 아래 일반 패턴으로 흘러갔고, 본문 딴 곳의 "50列"을 집어 50편으로 실렸다.
  // 하필 신장 두 통관구(阿拉山口·霍尔果斯) — 국경 통과량의 핵심 계열이다.
  //
  // 「超万列」처럼 숫자가 생략된 형태도 받는다. 중국어에서 万 앞의 一 는
  // 흔히 생략되므로, 超万 = 超1万 = 10,000 이다.
  const trainWanRe = [
    /(?:累计|共|总计|开行|通行|突破|超过|超)\D{0,12}?(\d[\d,，.]{0,8})\s*万\s*(?:列|趟)/,
    /(\d[\d,，.]{0,8})\s*万\s*(?:列|趟)/,
    /(?:突破|超过|超|近)\s*万\s*(?:列|趟)/,   // 숫자 생략형 — 一万 의 一 가 빠진 것
  ];
  for (let i = 0; i < trainWanRe.length; i++) {
    const m = text.match(trainWanRe[i]);
    if (!m) continue;
    const n = i === 2 ? 10000 : Math.round(parseFloat(m[1].replace(/[,，]/g, '')) * 10000);
    if (!isNaN(n) && n > 0 && n < 99999999) { s.trainCount = n; break; }
  }

  if (s.trainCount === undefined) {
    const trainRe = [
      /(?:累计|共|总计).*?(\d[\d,，]{0,9})\s*(?:列|趟)/,
      /开行.*?(\d[\d,，]{0,9})\s*(?:列|趟)/,
      /(\d[\d,，]{0,9})\s*(?:列|趟).*?(?:中欧|欧洲|国际)/,
      // 지수명이 숫자보다 앞에 오는 어순 — 「中欧班列2962列」.
      // 위 세 패턴은 숫자 뒤에 中欧 가 와야 걸린다. 중국어 기사 제목은
      // 이 순서가 더 흔한데 본문에 累计·开行 이 없으면 통째로 놓쳤다.
      /(?:中欧|欧洲|国际)(?:班列)?\D{0,10}?(\d[\d,，]{0,9})\s*(?:列|趟)/,
    ];
    for (const re of trainRe) {
      const m = text.match(re);
      if (m) {
        const n = parseInt(m[1].replace(/[,，]/g, ''));
        if (!isNaN(n) && n > 0 && n < 9999999) { s.trainCount = n; break; }
      }
    }
  }

  // TEU / 标准箱
  const teuRe = [
    /(\d[\d,，.]{0,8})\s*万\s*(?:TEU|标准箱|标箱)/i,
    /(\d[\d,，.]{0,8})\s*(?:TEU|标准箱|标箱)/i,
  ];
  for (let i = 0; i < teuRe.length; i++) {
    const m = text.match(teuRe[i]);
    if (m) {
      const n = parseFloat(m[1].replace(/[,，]/g, ''));
      if (!isNaN(n)) { s.teu = i === 0 ? n * 10000 : n; break; }
    }
  }

  // 货值 (亿美元/亿元)
  const valRe = /货值.*?(\d[\d,，.]{0,8})\s*亿?\s*(?:美元|USD|元)/i;
  const valM  = text.match(valRe);
  if (valM) {
    const n     = parseFloat(valM[1].replace(/[,，]/g, ''));
    const isYi  = /亿/.test(text.slice(text.indexOf(valM[0]), text.indexOf(valM[0]) + 10));
    if (!isNaN(n)) s.valueYi = isYi ? n : n / 100;
  }

  // YoY — find first percentage near 同比/增长/下降
  const yoyRe  = /(?:同比|增长|下降|增加|减少)\D{0,10}(\d{1,3}(?:\.\d+)?)\s*%/;
  const yoyM   = text.match(yoyRe);
  if (yoyM) {
    const n      = parseFloat(yoyM[1]);
    const isDown = /下降|减少/.test(text.slice(Math.max(0, text.indexOf(yoyM[0]) - 5), text.indexOf(yoyM[0]) + 15));
    if (!isNaN(n)) s.yoy = isDown ? -n : n;
  }

  // 운임 USD/TEU
  const rateRe = /(\d{3,6})\s*(?:美元|USD)\s*\/\s*(?:TEU|箱)/i;
  const rateM  = text.match(rateRe);
  if (rateM) {
    const n = parseInt(rateM[1].replace(/[,，]/g, ''));
    if (!isNaN(n) && n > 100 && n < 30000) s.rateUsdTeu = n;
  }

  return s;
}

function detectCongestion(text) {
  return CONGESTION_KW.some(kw => text.includes(kw));
}

// ── DeepSeek translation ──────────────────────────────────────────────────────

async function translateItems(items) {
  const toTranslate = items
    .map((item, idx) => ({ idx, title: item.title }))
    .filter(x => /[一-鿿]/.test(x.title));

  if (!toTranslate.length) return items.map(i => ({ ...i, titleKo: i.title }));

  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) return items.map(i => ({ ...i, titleKo: i.title }));

  try {
    const r = await fetch('https://api.deepseek.com/chat/completions', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey },
      body:    JSON.stringify({
        model:      'deepseek-v4-pro',
        max_tokens: 2000,
        thinking:   { type: 'disabled' },  // v4 추론의 소예산 잠식 방지 (번역 작업 — 추론 불필요)
        messages: [{
          role:    'user',
          content: `아래 중국어 철도·물류 기사 제목을 한국어로 번역. JSON 배열만 반환.\n입력: ${JSON.stringify(toTranslate)}\n출력 형식: [{"idx":0,"titleKo":"..."}]`,
        }],
      }),
      signal: AbortSignal.timeout(30000),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data   = await r.json();
    const raw    = (data.choices?.[0]?.message?.content || '').trim();
    const jsonM  = raw.match(/\[[\s\S]*\]/);
    if (!jsonM) throw new Error('JSON 없음');
    const trans = JSON.parse(jsonM[0]);
    const map   = {};
    for (const t of trans) map[t.idx] = t.titleKo;
    return items.map((item, idx) => ({ ...item, titleKo: map[idx] ?? item.title }));
  } catch (e) {
    console.warn('  rail-indices: 번역 실패:', e.message);
    return items.map(i => ({ ...i, titleKo: i.title }));
  }
}

// ── Table builder ─────────────────────────────────────────────────────────────

function buildTable(articles, month) {
  const withStats = articles.filter(a => a.stats && Object.keys(a.stats).length > 0);
  if (!withStats.length) return null;

  // 품질 계약 5조(범위 라벨 정확성): 개별 기사(거점)의 수치를 네트워크 전체처럼
  // 집계·라벨하지 않는다 — 기사별 행으로, 각 행에 자기 자신의 YoY를 붙인다.
  const rows = [];
  for (const a of withStats.slice(0, 4)) {
    const s = a.stats;
    const vol = [];
    if (s.trainCount) vol.push(`${s.trainCount.toLocaleString()}편`);
    if (s.teu)        vol.push(s.teu >= 10000 ? `${(s.teu / 10000).toFixed(1)}만TEU` : `${s.teu.toFixed(0)}TEU`);
    if (s.valueYi)    vol.push(`${s.valueYi.toFixed(1)}억USD`);
    if (!vol.length) continue;
    const yoy   = (s.yoy != null && !isNaN(s.yoy))
      ? `${s.yoy >= 0 ? '▲' : '▼'}${Math.abs(s.yoy).toFixed(1)}%`
      : '—';
    const label = String(a.titleKo || a.title || '').replace(/\|/g, '·').slice(0, 24);
    rows.push(`| ${label} | **${vol.join(' · ')}** | ${yoy} |`);
  }

  if (!rows.length) return null;

  return [
    '| 거점·이슈 (기사 기준) | 실적 | YoY |',
    '|------|------|-----|',
    ...rows,
    '',
    `※ ${month} 수집 기사 기준. 출처: [Landbridge](http://www.landbridge.com/yaowen/). 각 행은 개별 기사의 거점 실적이며 네트워크 전체 합계가 아님.`,
  ].join('\n');
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function buildRailIndices({ month, force = false } = {}) {
  const m         = month || new Date().toISOString().slice(0, 7);
  const cachePath = path.join(CACHE_DIR, `rail-index-${m}.json`);

  if (!force) {
    try {
      if (fs.existsSync(cachePath)) {
        const raw = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
        const age = Date.now() - new Date(raw.fetched_at).getTime();
        if (age < 24 * 60 * 60 * 1000) {
          console.log(`  rail-indices: 캐시 사용 (${m}, ${raw.fetched_at.slice(0, 10)})`);
          return raw;
        }
      }
    } catch (_) {}
  }

  console.log(`  rail-indices: Landbridge 수집 시작 (${m})...`);

  const allArticles = [];
  let   hasCongestion = false;

  for (const src of LANDBRIDGE_SOURCES) {
    const html = await fetchPage(src.url);
    if (!html) {
      console.warn(`  rail-indices: ${src.name} 접근 실패`);
      continue;
    }

    const links   = extractArticleLinks(html, src.url, m);
    const detLimit = src.priority === 'main' ? 5 : 2;
    console.log(`  rail-indices: ${src.name} — ${links.length}건`);

    for (const link of links.slice(0, detLimit)) {
      if (src.priority === 'secondary') {
        allArticles.push({ title: link.title, url: link.href, date: link.date, source: src.name, stats: {}, congestion: false });
        continue;
      }
      const detail = await fetchPage(link.href);
      if (!detail) continue;
      const text = stripHtml(detail);
      const stats = extractStats(text);
      const cong  = detectCongestion(text);
      if (cong) hasCongestion = true;
      allArticles.push({ title: link.title, url: link.href, date: link.date, source: src.name, stats, congestion: cong });
    }
  }

  if (!allArticles.length) {
    console.warn(`  rail-indices: ${m} 기사 없음 → null 반환`);
    return null;
  }

  const translated = await translateItems(allArticles);
  const table      = buildTable(translated, m);

  // Fact text for LLM
  const lines = [
    `## Landbridge 중국 철도·중국-유럽 화물열차 데이터 (대상 월: ${m})`,
    '',
  ];
  for (const a of translated.slice(0, 15)) {
    const ko = (a.titleKo && a.titleKo !== a.title) ? ` [${a.titleKo}]` : '';
    lines.push(`- [${a.source}] ${a.title}${ko} (${a.date})`);
    const s = a.stats;
    const details = [];
    if (s.trainCount)  details.push(`편수: ${s.trainCount.toLocaleString()}편`);
    if (s.teu)         details.push(`화물량: ${s.teu >= 10000 ? (s.teu / 10000).toFixed(1) + '만' : s.teu}TEU`);
    if (s.valueYi)     details.push(`화물가치: ${s.valueYi.toFixed(1)}억USD`);
    if (s.yoy != null) details.push(`YoY: ${s.yoy >= 0 ? '▲' : '▼'}${Math.abs(s.yoy).toFixed(1)}%`);
    if (s.rateUsdTeu)  details.push(`운임: ${s.rateUsdTeu.toLocaleString()}USD/TEU`);
    if (details.length) lines.push(`  수치: ${details.join(', ')}`);
  }

  lines.push('');
  if (hasCongestion) {
    lines.push(`## ⚠️ B-2 혼잡 신호: ${m} 기간 국경 혼잡 키워드 감지`);
    lines.push('아래 기사에 拥堵·积压·滞留·排队·停装·换装능력·车板·满负荷·通关延误 등 포함:');
    for (const a of translated.filter(a => a.congestion).slice(0, 3)) {
      lines.push(`- ${a.titleKo || a.title} (${a.date}) — ${a.url}`);
    }
    lines.push('→ 혼잡 블록을 본문에 포함하되, 이 기사에 나온 수치만 사용.');
  } else {
    lines.push(`## ℹ️ B-2 혼잡 게이팅: ${m} 기간 혼잡 키워드 미감지`);
    lines.push('이번 달 혼잡 관련 기사 없음 — **혼잡 블록을 본문에 포함하지 말 것.** 정량(편수·물동량·화물가치 YoY)만으로 마무리.');
  }

  const factText = lines.join('\n');

  const payload = {
    fetched_at:   new Date().toISOString(),
    month:        m,
    articleCount: allArticles.length,
    hasCongestion,
    table:        table || '',
    factText,
  };

  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(cachePath, JSON.stringify(payload, null, 2), 'utf-8');
  } catch (e) {
    console.warn('  rail-indices: 캐시 저장 실패:', e.message);
  }

  console.log(`  rail-indices: 완료 (${allArticles.length}건, 혼잡=${hasCongestion})`);
  return payload;
}

module.exports = { buildRailIndices, buildTable, extractStats };
