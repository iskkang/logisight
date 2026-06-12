// generators/web/generate-weekly-briefing.js
// 지난 7일 brief 기사 → DeepSeek 주제별 톱 선정 → weekly_briefings + points 적재.
// 환경변수: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DEEPSEEK_API_KEY
'use strict';

const path = require('path');
const ws = require('ws');
globalThis.WebSocket = ws;

const { createClient } = require('@supabase/supabase-js');
const { callDeepSeekJson } = require('../lib/deepseek');
const {
  mondayOf,
  subtitleFor,
  buildSelectionMessages,
  toPoints,
} = require('./lib/weekly-briefing.lib');

require('dotenv').config({ path: path.resolve(__dirname, '../../.env.local') });

async function main() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_URL 또는 SUPABASE_SERVICE_ROLE_KEY 없음');
  }
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
    realtime: { enabled: false },
  });

  const weekOf = mondayOf();
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const { data: articles, error } = await supabase
    .from('maritime_news')
    .select('title,summary,category,fetched_at')
    .eq('agent_type', 'brief')
    .not('slug', 'is', null)
    .gte('fetched_at', since)
    .order('fetched_at', { ascending: false });
  if (error) throw new Error(error.message);

  if (!articles || articles.length === 0) {
    console.warn('⚠️ 지난 7일 brief 기사 0건 — 주간 브리핑 적재 스킵');
    return;
  }

  const selection = await callDeepSeekJson({
    messages: buildSelectionMessages(articles),
    max_tokens: 3000,
  });

  const { data: briefing, error: bErr } = await supabase
    .from('weekly_briefings')
    .upsert({
      title: '주간 시장 브리핑',
      subtitle: subtitleFor(weekOf),
      week_of: weekOf,
      published_at: new Date().toISOString(),
      content: selection.content || null,
    }, { onConflict: 'week_of' })
    .select('id')
    .single();
  if (bErr) throw new Error(bErr.message);

  // 기존 point 삭제 후 재삽입 (재실행 멱등)
  const { error: dErr } = await supabase
    .from('weekly_briefing_points')
    .delete()
    .eq('briefing_id', briefing.id);
  if (dErr) throw new Error(dErr.message);

  const points = toPoints(briefing.id, selection);
  if (points.length > 0) {
    const { error: pErr } = await supabase.from('weekly_briefing_points').insert(points);
    if (pErr) throw new Error(pErr.message);
  }

  console.log(`✅ 주간 브리핑 적재: week_of=${weekOf}, points=${points.length}`);
  for (const p of points) console.log(`   [${p.category}] ${p.headline}`);
}

main().catch((e) => {
  console.error('❌ generate-weekly-briefing 실패:', e.message);
  process.exit(1);
});
