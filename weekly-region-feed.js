'use strict';
// 권역 위클리 feed 생산기 (권역 인지 큐레이션):
// maritime_news(한글 brief + 영문/노어/스페인어 external)를 권역에 단일 배정(assignPool, 주체 게이트) →
// 거시/지수/라운드업은 글로벌 제외 → 비한글 카드는 DeepSeek로 한글 번역·요약 → briefType 그룹 큐레이션 →
// rich JSON(items[] + selection)으로 content/weekly-region/<week>-<region>.json 저장. PDF는 weekly-region-pdf.js.
// weekly-report 파일 import/수정 없음(독립).
// 사용법: node weekly-region-feed.js [--week=2026-W26] [--region=europe]
const fs = require('fs');
const path = require('path');
const ws = require('ws'); globalThis.WebSocket = ws;
require('dotenv').config({ path: path.resolve(__dirname, '.env.local') });
const { createClient } = require('@supabase/supabase-js');
const { callDeepSeekJson } = require('./generators/lib/deepseek');
const { SHARED_TYPE_RULES } = require('./lib/region-filter');
const { assignPool, REGIONS } = require('./lib/region-assign');
const { buildRegionSelectionMessages } = require('./generators/web/lib/weekly-briefing.lib');

const CATS = ['해상', '항공', '무역', '물류', '철도'];   // 철도=러시아·CIS·TCR/TSR 통로(권역 배정은 주체 게이트가 결정)
const PER_REGION = 14;   // 권역당 카드 상한(번역 비용·분량)
const MIN_BODY = 120;    // 본문 미달 카드 제외(유료벽/요약만 출처의 2~3줄 빈약 카드)
const arg = (n) => { const a = process.argv.find((x) => x.startsWith(`--${n}=`)); return a ? a.split('=')[1] : null; };

function isoWeekId(d) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const ys = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const wn = Math.ceil(((t - ys) / 86400000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(wn).padStart(2, '0')}`;
}
function weekPeriod(d) {
  const t = new Date(d); const off = (t.getDay() + 6) % 7;   // 0=월
  const mon = new Date(t); mon.setDate(t.getDate() - off);
  const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
  const f = (x) => `${String(x.getMonth() + 1).padStart(2, '0')}/${String(x.getDate()).padStart(2, '0')}`;
  return `${f(mon)}~${f(sun)}`;
}
function cleanBody(s) {
  let body = String(s || '').replace(/\r/g, '').replace(/[ \t]+/g, ' ').trim();
  body = body.replace(/\n?\*?\s*출처\s*[:：][^\n]*\*?\s*$/, '').trim();
  if (body.length > 900) body = body.slice(0, 900).replace(/\s+\S*$/, '') + '…';
  return body;
}

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const IMG_KW = { '해상': 'container ship port', '항공': 'air cargo freighter', '철도': 'freight train railway', '무역': 'cargo port trade', '물류': 'logistics warehouse cargo' };

// 이미지 URL이 실제 이미지로 로드되는지 검증(만료 토큰·404·핫링크 차단 컷)
async function imageOk(url) {
  if (!url) return false;
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(8000) });
    if (!r.ok) return false;
    return (r.headers.get('content-type') || '').toLowerCase().startsWith('image/');
  } catch { return false; }
}

// Unsplash 대체 이미지(키워드 기반). 키 없거나 실패 시 null.
async function unsplashImage(keyword) {
  const key = process.env.UNSPLASH_ACCESS_KEY;
  if (!key) return null;
  try {
    const url = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(keyword)}&orientation=landscape&per_page=1&client_id=${key}`;
    const r = await fetch(url, { headers: { 'Accept-Version': 'v1' }, signal: AbortSignal.timeout(10000) });
    if (!r.ok) return null;
    const photo = (await r.json())?.results?.[0];
    return photo?.urls?.regular ? `${photo.urls.regular}&w=1200&h=675&fit=crop` : null;
  } catch { return null; }
}

// 원본 이미지가 로드되면 유지, 실패하면 Unsplash, 그것도 없으면 null(카드에서 이미지 영역 생략)
async function resolveImage(image, keyword) {
  if (await imageOk(image)) return image;
  return (await unsplashImage(keyword)) || null;
}

// 한글 brief는 그대로, 비한글(영문·노어·스페인어) external은 DeepSeek로 한 번에 번역·요약해 카드화.
async function translateCards(arts) {
  const cards = arts.map((a) => ({
    briefType: a.briefType, tag: a.category || '', image: a.image_url || null,
    source: a.source || '', url: a.url || '', ko: /[가-힣]/.test(a.title || ''),
    t0: a.title || '', s0: a.summary || '', c0: a.content || '',
    headline: '', lead: '', body: '',
  }));
  for (const c of cards) if (c.ko) { c.headline = c.t0; c.lead = c.s0; c.body = cleanBody(c.c0); }

  const ext = cards.filter((c) => !c.ko);
  if (ext.length) {
    const list = ext.map((c, i) => `${i}. TITLE: ${c.t0}\nLEAD: ${(c.s0 || '').slice(0, 200)}\nBODY: ${(c.c0 || '').slice(0, 700)}`).join('\n\n');
    const messages = [{ role: 'user', content: `다음 ${ext.length}개 해외 물류 기사를 한국어로 번역·요약한다.
각 항목: headline(간결한 한국어 헤드라인 25~40자, 명사형 종결), lead(한 문장 요약), body(원문의 핵심 사실·수치·맥락을 충실히 담아 4~6문장; 원문이 짧으면 가능한 만큼. 보고된 내용만, 환각·과장 금지).
고유명사·항만·기업명·수치는 보존. ~입니다·~합니다 금지(~기록했다·~밝혔다 어미).
반드시 JSON만: {"cards":[{"i":0,"headline":"...","lead":"...","body":"..."}, ...]}

기사 목록:
${list}` }];
    try {
      const res = await callDeepSeekJson({ messages, max_tokens: 4000 });
      const byI = new Map(((res && res.cards) || []).map((x) => [x.i, x]));
      ext.forEach((c, i) => {
        const tr = byI.get(i) || {};
        c.headline = (tr.headline || c.t0).trim();
        c.lead = (tr.lead || '').trim();
        c.body = (tr.body || '').trim();
      });
    } catch (e) {
      console.warn('  [translate] 실패, 원문 사용:', e.message);
      for (const c of ext) { c.headline = c.t0; c.lead = c.s0; c.body = cleanBody(c.c0); }
    }
  }
  // 이미지: 원본 로드 검증 → 실패 시 Unsplash 폴백 → 없으면 null(깨진 이미지 박스 방지)
  await Promise.all(cards.map(async (c) => {
    c.image = await resolveImage(c.image, IMG_KW[c.tag] || 'global logistics cargo supply chain');
  }));

  return cards.map((c) => ({ briefType: c.briefType, tag: c.tag, headline: c.headline, lead: c.lead, image: c.image, body: c.body, source: c.source, url: c.url }));
}

async function main() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('SUPABASE_URL/SERVICE_ROLE_KEY 없음');
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false }, realtime: { enabled: false } });

  const cfgs = {};
  for (const r of REGIONS) cfgs[r] = require('./config/regions/' + r + '.js');

  const now = new Date();
  const week = arg('week') || isoWeekId(now);
  const period = weekPeriod(now);
  const only = arg('region');
  const sinceISO = new Date(now.getTime() - 7 * 86400000).toISOString();

  // 풀: 본문 있는 기사 전량(한글 brief + 영문/노어/스페인어 external). 언어·이미지 무관 — 주체 게이트가 권역 결정.
  const pool = []; const seen = new Set();
  for (const cat of CATS) {
    const { data, error } = await supabase.from('maritime_news')
      .select('title,summary,content,image_url,source,url,category,agent_type,published_at')
      .eq('category', cat).gte('published_at', sinceISO)
      .order('published_at', { ascending: false }).limit(80);
    if (error) throw new Error(error.message);
    for (const r of (data || [])) {
      if ((r.content || '').length <= 200) continue;            // 본문 있는 것만(카드용)
      const key = r.url || r.title;
      if (seen.has(key)) continue;
      seen.add(key); pool.push(r);
    }
  }

  // 단일 배정: 거시/지수/라운드업 → global, 권역은 주체 게이트(제목+리드 앵커 + 지배성)
  const buckets = assignPool(pool, cfgs, { dominanceMargin: 1 });
  const counts = Object.fromEntries(REGIONS.map((r) => [r, buckets[r].length]));
  console.log(`풀 ${pool.length} → 배정`, counts, `| global ${buckets.global.length}`);

  const dir = path.join(__dirname, 'content/weekly-region');
  fs.mkdirSync(dir, { recursive: true });

  for (const region of (only ? [only] : REGIONS)) {
    const arts = (buckets[region] || []).slice(0, PER_REGION);
    if (!arts.length) {
      const stale = path.join(dir, `${week}-${region}.json`);
      if (fs.existsSync(stale)) { fs.unlinkSync(stale); console.log(`  [${region}] 0건 — stale feed 삭제`); }
      else console.log(`  [${region}] 0건 — 생략`);
      continue;
    }

    const cfg = cfgs[region];
    const koN = arts.filter((a) => /[가-힣]/.test(a.title || '')).length;
    let cards = await translateCards(arts);
    const before = cards.length;
    cards = cards.filter((c) => (c.body || '').length >= MIN_BODY);   // 빈약 카드(유료벽/요약만) 제외
    if (!cards.length) {
      const stale = path.join(dir, `${week}-${region}.json`);
      if (fs.existsSync(stale)) fs.unlinkSync(stale);
      console.log(`  [${region}] 본문 충실 카드 0건(전체 ${before}) — 생략`);
      continue;
    }
    const byType = cards.reduce((m, c) => { m[c.briefType] = (m[c.briefType] || 0) + 1; return m; }, {});
    const focus = cfg.promptFocus + ' ' + SHARED_TYPE_RULES;
    const selArticles = cards.map((c) => ({ title: c.headline, summary: c.lead, briefType: c.briefType }));
    const selection = await callDeepSeekJson({ messages: buildRegionSelectionMessages(selArticles, focus), max_tokens: 3000 });

    const out = {
      region, label: cfg.label, week, period,
      generated_at: now.toISOString().slice(0, 10),
      by_type: byType, selection, items: cards,
    };
    fs.writeFileSync(path.join(dir, `${week}-${region}.json`), JSON.stringify(out, null, 2), 'utf-8');
    console.log(`✅ [${region}] feed: items ${cards.length} (한글 ${koN}, 번역 ${cards.length - koN})`, byType);
  }
}

main().catch((e) => { console.error('feed 생성 실패:', e.message); process.exit(1); });
