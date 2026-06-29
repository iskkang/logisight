'use strict';

// 유라시아(유럽) 철도 전용 번역 게시 — index1520 메타피드가 maritime_news 에 lang='en' 으로
// 직접 적재되어 큐레이션·번역 단계를 건너뛰는 갭을 메운다. 기존 철도 뉴스와 동일한
// resolveArticle + generateKoreanAnalysis(DeepSeek, KSG 문체) 프로세스를 그대로 재현해
// 최신 미번역 index1520 기사를 lang='ko' 로 발행한다(같은 url 로 upsert → en 행이 ko 로 교체).
// 발행되면 자동으로 /news?cat=철도(한국어)에 노출되고, /rail/europe(영어 필터)에서는 사라진다.

const path = require('path');
const ws = require('ws');
globalThis.WebSocket = ws;

const { createClient } = require('@supabase/supabase-js');
const { callDeepSeek } = require('../lib/deepseek');
const { generateKoreanAnalysis, resolveArticle } = require('./lib/news-pipeline');

require('dotenv').config({ path: path.resolve(__dirname, '../../.env.local') });

const LIMIT = Number(process.env.RAIL_EURASIA_TRANSLATE_LIMIT || 2); // 실행당 번역 게시 건수(쿼터)
const POOL = Math.max(LIMIT * 3, 6); // 번역 실패(본문 부족) 시 다음 후보로 넘어가기 위한 조회 폭
const KEYWORD = 'freight train railway eurasia europe';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  { auth: { persistSession: false }, realtime: { enabled: false } },
);

function makeSlug(date, title) {
  return `${date}-${String(title || '')
    .toLowerCase()
    .replace(/[^a-z0-9가-힣\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 60)}`;
}

async function main() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_URL 또는 SUPABASE_SERVICE_ROLE_KEY 없음');
  }
  if (!process.env.DEEPSEEK_API_KEY) {
    throw new Error('DEEPSEEK_API_KEY 없음');
  }

  // 미번역 index1520 유라시아 철도 기사: lang='en', category='철도', url=index1520.com
  const { data: rows, error } = await supabase
    .from('maritime_news')
    .select('url,title,summary,source,published_at')
    .eq('lang', 'en')
    .eq('category', '철도')
    .ilike('url', '%index1520.com%')
    .order('published_at', { ascending: false, nullsFirst: false })
    .limit(POOL);
  if (error) throw new Error(error.message);

  if (!rows?.length) {
    console.log('[rail-eurasia] 신규 미번역 index1520 기사 없음');
    return;
  }

  let published = 0;
  for (const item of rows) {
    if (published >= LIMIT) break;
    try {
      const asset = await resolveArticle(item.url, {
        source: item.source,
        keyword: KEYWORD,
        title: item.title,
      });
      const generated = await generateKoreanAnalysis(
        callDeepSeek,
        asset.articleText,
        `${item.source || 'index1520'} / ${item.title}`,
      );
      if (!generated?.body) {
        console.warn(`⚠️ 본문 부족 — 건너뜀: ${item.url}`);
        continue;
      }

      const date = String(item.published_at || new Date().toISOString()).slice(0, 10);
      const summary = generated.body.split('\n').map((l) => l.trim()).find(Boolean)?.slice(0, 150) || null;
      const row = {
        title: generated.title || item.title,
        summary,
        content: generated.body,
        url: item.url, // onConflict url → 기존 en 행을 ko 로 교체
        source: item.source || 'index1520',
        category: '철도',
        lang: 'ko',
        is_hero: false,
        agent_type: 'brief',
        tags: ['rail', 'eurasia'],
        slug: makeSlug(date, generated.title || item.title),
        published_at: item.published_at || new Date().toISOString(),
        fetched_at: new Date().toISOString(),
        image_url: asset.imageUrl,
        image_source: asset.imageSource,
        image_credit: asset.imageCredit,
      };

      const { error: upErr } = await supabase
        .from('maritime_news')
        .upsert(row, { onConflict: 'url', ignoreDuplicates: false });
      if (upErr) throw new Error(upErr.message);

      published += 1;
      console.log(`✅ [철도/유라시아] ${row.title.slice(0, 50)}`);
    } catch (e) {
      console.error(`❌ ${item.url}: ${e.message}`);
    }
  }

  console.log(`📊 유라시아 철도 번역 게시: ${published}건 (조회 ${rows.length} / 쿼터 ${LIMIT})`);
}

main().catch((error) => {
  console.error(`❌ publish-rail-eurasia 실패: ${error.message}`);
  process.exit(1);
});
