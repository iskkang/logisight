// scripts/publish-daily-cards-to-site.js
//
// 역할: 큐레이션된 rail/ocean 뉴스를 "일간 브리핑 카드"로 maritime_news에 upsert.
//
// ★ 이 스크립트는 웹사이트 기사(article)를 생성하지 않습니다.
//   - agent_type = 'daily_card'
//   - slug = null  (내부 /article/:slug 라우팅 없음)
//   - 카드는 클릭 시 원문 URL로 이동
//
// 웹사이트 기사 생성은 generate-article-shipping.js / generate-article-brief.js 사용.
//
// 입력: content/drafts/curated-rail.json, content/drafts/curated-ocean.json
// 환경변수: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DEEPSEEK_API_KEY

'use strict';

const fs   = require('fs');
const path = require('path');

const ws = require('ws');
globalThis.WebSocket = ws;

const { createClient } = require('@supabase/supabase-js');
const { callDeepSeek } = require('../lib/deepseek');

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

const CATEGORY_MAP = { rail: '철도', ocean: '해상', air: '항공', trade: '물류' };

// og:image / twitter:image 추출, 없으면 첫 <img> fallback. 상대경로 → 절대경로 변환
async function fetchOgImage(url) {
  try {
    const origin = new URL(url).origin;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(8000),
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Logisight/1.0)' },
    });
    const html = await res.text();

    const toAbsolute = (img) => {
      if (!img || img === 'null') return null;
      if (img.startsWith('http')) return img;
      if (img.startsWith('//'))   return `https:${img}`;
      if (img.startsWith('/'))    return `${origin}${img}`;
      return `${origin}/${img}`;
    };

    const metaPatterns = [
      /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
      /<meta[^>]+name=["']twitter:image(?::src)?["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image/i,
    ];

    for (const pattern of metaPatterns) {
      const match = html.match(pattern);
      if (match?.[1]) {
        const result = toAbsolute(match[1].trim());
        if (result) return result;
      }
    }

    // fallback: 첫 번째 <img src>
    const imgMatch = html.match(/<img[^>]+src=["']([^"']+\.(?:jpg|jpeg|png|webp)(?:[^"']*)?)["']/i);
    if (imgMatch?.[1]) {
      const result = toAbsolute(imgMatch[1].trim());
      if (result) return result;
    }

    console.log(`ℹ️  og:image 없음: ${url.slice(0, 80)}`);
    return null;
  } catch (e) {
    console.log(`ℹ️  og:image fetch 실패 (${url.slice(0, 60)}): ${e.message}`);
    return null;
  }
}

// 본문 텍스트 추출 (한국어 요약용). 실패 시 "" 반환
async function fetchArticleText(url) {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(8000),
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Logisight/1.0)' },
    });
    const html = await res.text();

    const cleaned = html
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');

    const texts = [...cleaned.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)]
      .map(m => m[1].replace(/<[^>]+>/g, '').trim())
      .filter(t => t.length > 40);

    const result = texts.join(' ').slice(0, 3000);
    const looksLikeCss = (result.match(/[{};]/g) || []).length > 10;
    return looksLikeCss ? '' : result;
  } catch { return ''; }
}

// DeepSeek으로 한국어 2문장 요약 (링크 기사용)
async function summarizeKorean(articleText) {
  if (!process.env.DEEPSEEK_API_KEY) return null;
  try {
    const msg = await callDeepSeek({
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
    console.error('⚠️  Claude 요약 실패:', e.message);
    return null;
  }
}

// DB 오염 데이터 정리 (CSS 텍스트가 summary로 저장된 레코드)
async function cleanStaleData(supabase) {
  const { error } = await supabase
    .from('maritime_news')
    .update({ summary: null })
    .like('summary', '기사 본문 내용이 CSS%');
  if (error) console.error('cleanup error:', error.message);
  else console.log('🧹 오염 데이터 정리 완료');
}

// main 브리핑 카드 upsert
// agent_type = 'daily_card', slug = null → 내부 기사 페이지 없음
async function upsertMainCard(supabase, curated) {
  const { main, section, date } = curated;
  if (!main?.url || !(main.importance_score > 0)) {
    console.log(`⏭️  [${section}] main 카드 스킵 (importance_score=${main?.importance_score})`);
    return;
  }
  if (!main.title_ko || !main.source) {
    console.warn(`⚠️  [${section}] main 스킵 — title_ko 또는 source 누락`);
    return;
  }

  const category = CATEGORY_MAP[section] ?? '물류';
  const imageUrl  = await fetchOgImage(main.url);

  const row = {
    title:        main.title_ko,
    summary:      main.what,          // 카드 요약: what 필드 (200자 내외)
    content:      null,               // 브리핑 카드는 본문 없음
    url:          main.url,
    source:       main.source,
    category,
    lang:         'ko',
    is_hero:      true,               // 홈페이지 히어로 카드
    agent_type:   'daily_card',       // ★ 브리핑 카드 식별자
    tags:         [section],
    slug:         null,               // ★ 내부 라우팅 없음 → 원문 URL로 이동
    published_at: new Date().toISOString(),
    fetched_at:   new Date().toISOString(),
  };
  if (imageUrl) row.image_url = imageUrl;

  const { error } = await supabase
    .from('maritime_news')
    .upsert(row, { onConflict: 'url', ignoreDuplicates: false });

  if (error) {
    console.error(`❌ [${section}] main 카드 upsert 실패:`, error.message);
  } else {
    console.log(`✅ daily_card [${section}] main: ${main.title_ko.slice(0, 50)}`);
    if (imageUrl) console.log(`   🖼️  image: ${imageUrl.slice(0, 70)}`);
  }
}

// 관련 링크 카드 upsert
// agent_type = 'daily_card', slug = null, is_hero = false
async function upsertLinkCard(supabase, link, section) {
  if (!link.title_ko || !link.url || !link.source) {
    console.warn(`⏭️  [${section}] link 스킵 — 필수 필드 누락`);
    return;
  }

  const category = CATEGORY_MAP[section] ?? '물류';
  const imageUrl  = await fetchOgImage(link.url);

  const articleText = await fetchArticleText(link.url);
  if (!articleText) {
    console.log(`ℹ️  [${section}] 본문 없음 (JS 렌더링 또는 접근 불가): ${link.url.slice(0, 60)}`);
  }

  const translatedSummary = articleText.length >= 100 ? await summarizeKorean(articleText) : null;
  const summary = translatedSummary || link.title_ko;

  const row = {
    title:        link.title_ko,
    summary,
    content:      null,               // 관련 링크는 본문 없음
    url:          link.url,
    source:       link.source,
    category,
    lang:         'ko',
    is_hero:      false,
    agent_type:   'daily_card',       // ★ 브리핑 카드 식별자
    tags:         [section],
    slug:         null,               // ★ 내부 라우팅 없음
    published_at: new Date().toISOString(),
    fetched_at:   new Date().toISOString(),
  };
  if (imageUrl) row.image_url = imageUrl;

  const { error } = await supabase
    .from('maritime_news')
    .upsert(row, { onConflict: 'url', ignoreDuplicates: false });

  if (error) {
    console.error(`❌ [${section}] link 카드 upsert 실패 (${link.url}):`, error.message);
  } else {
    console.log(`✅ daily_card [${section}] link: ${link.title_ko.slice(0, 50)}`);
  }
}

async function processSection(supabase, filename) {
  const filePath = path.join(DRAFTS_DIR, filename);
  if (!fs.existsSync(filePath)) {
    console.warn(`⚠️  ${filename} 없음 — 스킵`);
    return;
  }

  const curated = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  const section = curated.section;
  const date    = curated.date ?? TODAY;

  console.log(`\n📰 [${section}] 브리핑 카드 처리 시작 (${date})`);
  console.log(`   ★ agent_type=daily_card, slug=null (내부 기사 페이지 미생성)`);

  await upsertMainCard(supabase, curated);

  const links = curated.links ?? [];
  for (const link of links) {
    try {
      await upsertLinkCard(supabase, link, section);
    } catch (e) {
      console.error(`❌ [${section}] link 카드 처리 중 예외:`, e.message);
    }
  }

  console.log(`✅ [${section}] 완료 (links: ${links.length}건)`);
}

async function main() {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error('❌ SUPABASE_URL 또는 SUPABASE_SERVICE_ROLE_KEY 없음');
    process.exit(1);
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
    realtime: { enabled: false },
  });

  console.log('📋 publish-daily-cards-to-site 시작');
  console.log('   역할: 뉴스레터 브리핑 카드 → maritime_news (daily_card)');
  console.log('   웹사이트 기사 생성: generate-article-shipping.js / generate-article-brief.js 사용');

  await cleanStaleData(supabase);
  await processSection(supabase, 'curated-rail.json');
  await processSection(supabase, 'curated-ocean.json');
  await processSection(supabase, 'curated-air.json');
  await processSection(supabase, 'curated-trade.json');

  console.log('\n🎉 publish-daily-cards-to-site 완료');
}

main().catch(e => {
  console.error('❌ publish-daily-cards-to-site 실패:', e.message);
  process.exit(1);
});
