// generators/email/generate-newsletter-from-site.js
// 당일(KST) 사이트 발행 내부 기사(maritime_news)를 읽어 뉴스레터 HTML 생성.
// 소스: daily-web-articles.yml이 매일 적재하는 brief(내부기사) + shipping 기사.
// 수집·큐레이션·LLM 호출 없음. 환경변수: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// 출력: content/drafts/newsletter-YYYY-MM-DD.html (당일 기사 0건이면 미생성 + exit 0)
'use strict';

const fs = require('fs');
const path = require('path');
const ws = require('ws');
globalThis.WebSocket = ws;

const { createClient } = require('@supabase/supabase-js');
const { kstToday, pickArticles, buildHtml } = require('./newsletter-from-site.lib');

require('dotenv').config({ path: path.resolve(__dirname, '../../.env.local') });

async function main() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_URL 또는 SUPABASE_SERVICE_ROLE_KEY 없음');
  }
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
    realtime: { enabled: false },
  });

  const today = kstToday();
  const { data, error } = await supabase
    .from('maritime_news')
    .select('title,summary,slug,category,image_url,image_credit,fetched_at,is_hero')
    .in('agent_type', ['brief', 'shipping'])
    .not('slug', 'is', null)
    .gte('fetched_at', `${today}T00:00:00+09:00`)
    .order('fetched_at', { ascending: false });
  if (error) throw new Error(error.message);

  const articles = pickArticles(data);
  if (articles.length === 0) {
    console.warn('⚠️ 당일 내부 기사 0건 — HTML 생성 스킵');
    return;
  }

  const out = path.resolve(__dirname, `../../content/drafts/newsletter-${today}.html`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, buildHtml(articles, today), 'utf-8');
  console.log(`✅ newsletter HTML 생성 (${articles.length}개 카드): ${out}`);
}

main().catch((e) => {
  console.error('❌ generate-newsletter-from-site 실패:', e.message);
  process.exit(1);
});
