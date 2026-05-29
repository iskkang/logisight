// scripts/publish-curated-to-site.js
// 큐레이션된 rail/ocean 뉴스를 maritime_news에 upsert
// 입력: content/drafts/curated-rail.json, content/drafts/curated-ocean.json
// 환경변수: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY

'use strict';

const fs   = require('fs');
const path = require('path');

const ws = require('ws');
globalThis.WebSocket = ws;

const { createClient } = require('@supabase/supabase-js');
const Anthropic = require('@anthropic-ai/sdk').default;

const DRAFTS_DIR = path.resolve(__dirname, '../content/drafts');
const TODAY      = new Date().toISOString().slice(0, 10);

// .env.local 로드 (로컬 실행 시)
function loadEnvLocal() {
  const envPath = path.resolve(__dirname, '../.env.local');
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, 'utf-8').split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}
loadEnvLocal();

const SUPABASE_URL  = process.env.SUPABASE_URL ?? '';
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY ?? '';

const CATEGORY_MAP = { rail: '철도', ocean: '해상' };

// og:image 또는 twitter:image 추출. 상대경로 → 절대경로 변환. 실패 시 null
async function fetchOgImage(url) {
  try {
    const origin = new URL(url).origin;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(8000),
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Logisight/1.0)' },
    });
    const html = await res.text();

    const patterns = [
      /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
      /<meta[^>]+name=["']twitter:image(?::src)?["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image/i,
    ];

    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match?.[1]) {
        const img = match[1].trim();
        if (!img || img === 'null') continue;
        if (img.startsWith('http')) return img;
        if (img.startsWith('//'))   return `https:${img}`;
        if (img.startsWith('/'))    return `${origin}${img}`;
        return `${origin}/${img}`;
      }
    }
    return null;
  } catch { return null; }
}

// 본문 텍스트 추출 (번역용). 실패 시 "" 반환
async function fetchArticleText(url) {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(8000),
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Logisight/1.0)' },
    });
    const html = await res.text();

    // style/script 블록 먼저 제거
    const cleaned = html
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');

    const texts = [...cleaned.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)]
      .map(m => m[1].replace(/<[^>]+>/g, '').trim())
      .filter(t => t.length > 40);

    const result = texts.join(' ').slice(0, 3000);

    // CSS처럼 보이면 빈 문자열 반환
    const looksLikeCss = (result.match(/[{};]/g) || []).length > 10;
    return looksLikeCss ? '' : result;
  } catch { return ''; }
}

// Claude로 한국어 2문장 요약
async function summarizeKorean(articleText) {
  if (!ANTHROPIC_KEY) return null;
  try {
    const client = new Anthropic({ apiKey: ANTHROPIC_KEY });
    const msg = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 300,
      messages: [{
        role: 'user',
        content: `다음 텍스트가 CSS나 HTML 코드이면 "SKIP"이라고만 답해라.
실제 기사라면 한국어 2문장 이내 요약. 화주·포워더 시각. 요약 텍스트만 출력:

${articleText}`,
      }],
    });
    const response = msg.content[0].text.trim();
    if (!response || response === 'SKIP' || response.includes('CSS')) return null;
    return response;
  } catch (e) {
    console.error('⚠️ Claude 요약 실패:', e.message);
    return null;
  }
}

// 웹 기사 본문 생성. checkpoint는 뉴스레터 전용이므로 제외
function buildContent(main) {
  return [main.what, main.why_now]
    .filter(Boolean)
    .join('\n\n');
}

// slug 생성: "{date}-{title_ko 공백→하이픈, 60자 제한}"
function makeSlug(date, titleKo) {
  const slugified = titleKo
    .toLowerCase()
    .replace(/[^a-z0-9가-힣\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 60);
  return `${date}-${slugified}`;
}

// main 기사 upsert
async function upsertMain(supabase, curated) {
  const { main, section, date } = curated;
  if (!main?.url || !(main.importance_score > 0)) {
    console.log(`⏭️  [${section}] main 기사 스킵 (importance_score=${main?.importance_score})`);
    return;
  }

  const category   = CATEGORY_MAP[section] ?? '물류';
  const imageUrl   = await fetchOgImage(main.url);
  const content    = buildContent(main);

  const row = {
    title:        main.title_ko,
    summary:      main.what,
    content,
    url:          main.url,
    source:       main.source,
    category,
    lang:         'ko',
    is_hero:      true,
    agent_type:   'brief',
    tags:         [section],
    slug:         makeSlug(date, main.title_ko),
    published_at: new Date().toISOString(),
    image_url:    imageUrl,
    fetched_at:   new Date().toISOString(),
  };

  const { error } = await supabase
    .from('maritime_news')
    .upsert(row, { onConflict: 'url', ignoreDuplicates: false });

  if (error) {
    console.error(`❌ [${section}] main upsert 실패:`, error.message);
  } else {
    console.log(`✅ [${section}] main 저장: ${main.title_ko.slice(0, 40)}`);
  }
}

// link 기사 upsert
async function upsertLink(supabase, link, section, date) {
  const category   = CATEGORY_MAP[section] ?? '물류';
  const imageUrl        = await fetchOgImage(link.url);
  const articleText     = await fetchArticleText(link.url);
  const translatedSummary = articleText.length >= 100 ? await summarizeKorean(articleText) : null;
  const summary         = translatedSummary || link.title_ko || null;

  const row = {
    title:        link.title_ko,
    summary,
    content:      null,
    url:          link.url,
    source:       link.source,
    category,
    lang:         'ko',
    is_hero:      false,
    agent_type:   'brief',
    tags:         [section],
    slug:         makeSlug(date, link.title_ko),
    published_at: new Date().toISOString(),
    image_url:    imageUrl,
    fetched_at:   new Date().toISOString(),
  };

  const { error } = await supabase
    .from('maritime_news')
    .upsert(row, { onConflict: 'url', ignoreDuplicates: false });

  if (error) {
    console.error(`❌ [${section}] link upsert 실패 (${link.url}):`, error.message);
  } else {
    console.log(`✅ [${section}] link 저장: ${link.title_ko.slice(0, 40)}`);
  }
}

async function processSection(supabase, filename) {
  const filePath = path.join(DRAFTS_DIR, filename);
  if (!fs.existsSync(filePath)) {
    console.warn(`⚠️ ${filename} 없음 — 스킵`);
    return;
  }

  const curated = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  const section = curated.section;
  const date    = curated.date ?? TODAY;

  console.log(`\n📰 [${section}] 처리 시작 (${date})`);

  await upsertMain(supabase, curated);

  const links = curated.links ?? [];
  for (const link of links) {
    try {
      await upsertLink(supabase, link, section, date);
    } catch (e) {
      console.error(`❌ [${section}] link 처리 중 예외:`, e.message);
    }
  }

  console.log(`✅ [${section}] 완료 (links: ${links.length}건)`);
}

async function cleanStaleData(supabase) {
  const { error } = await supabase
    .from('maritime_news')
    .update({ summary: null })
    .like('summary', '기사 본문 내용이 CSS%');
  if (error) console.error('cleanup error:', error.message);
  else console.log('🧹 오염 데이터 정리 완료');
}

async function main() {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error('❌ SUPABASE_URL 또는 SUPABASE_SERVICE_ROLE_KEY 없음');
    process.exit(1);
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
    realtime: { enabled: false },
  });

  await cleanStaleData(supabase);
  await processSection(supabase, 'curated-rail.json');
  await processSection(supabase, 'curated-ocean.json');

  console.log('\n🎉 publish-curated-to-site 완료');
}

main().catch(e => {
  console.error('❌ publish-curated-to-site 실패:', e.message);
  process.exit(1);
});
