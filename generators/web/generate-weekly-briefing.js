// generators/web/generate-weekly-briefing.js
// 지난 7일 brief 기사 → DeepSeek 주제별 톱 선정 → weekly_briefings + points 적재.
// 환경변수: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DEEPSEEK_API_KEY
'use strict';

const fs = require('fs');
const path = require('path');
const ws = require('ws');
globalThis.WebSocket = ws;

const { createClient } = require('@supabase/supabase-js');
const { callDeepSeekJson } = require('../lib/deepseek');
const {
  mondayOf,
  subtitleFor,
  buildSelectionMessages,
  buildRegionSelectionMessages,
  toPoints,
  sanitizeHanja,
} = require('./lib/weekly-briefing.lib');

require('dotenv').config({ path: path.resolve(__dirname, '../../.env.local') });

async function main() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_URL 또는 SUPABASE_SERVICE_ROLE_KEY 없음');
  }
  if (!process.env.DEEPSEEK_API_KEY) {
    throw new Error('DEEPSEEK_API_KEY 없음');
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

  // ── 권역 모드(v2): region AND (korea OR policy OR trade) 필터 → briefType 그룹 큐레이션. 미지정 시 전역 동작 유지 ──
  const regionArg = process.argv.find((a) => a.startsWith('--region='));
  const region = regionArg ? regionArg.split('=')[1] : null;
  if (region) {
    const regionCfg = require('../../config/regions/' + region + '.js');
    const { filterByRegion, SHARED_TYPE_RULES } = require('../../lib/region-filter.js');
    const curated = filterByRegion(articles, regionCfg, 14);
    const byType = curated.reduce((m, a) => { m[a.briefType] = (m[a.briefType] || 0) + 1; return m; }, {});
    console.log(`  [region=${region}/${regionCfg.label}] 필터 통과 ${curated.length}/${articles.length}건`, byType);
    if (curated.length === 0) {
      console.warn(`⚠️ [region=${region}] 통과 기사 0건 — 더미 없이 권역 브리핑 생략`);
      return;
    }
    const focus = regionCfg.promptFocus + ' ' + SHARED_TYPE_RULES;
    const regionSel = await callDeepSeekJson({
      messages: buildRegionSelectionMessages(curated, focus),
      max_tokens: 3000,
    });
    const outDir = path.resolve(__dirname, '../../content/weekly-region');
    fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, `${weekOf}-${region}.json`);
    fs.writeFileSync(outPath, JSON.stringify({
      region,
      label: regionCfg.label,
      week_of: weekOf,
      article_count: curated.length,
      by_type: byType,
      generated_at: new Date().toISOString(),
      selection: regionSel,
    }, null, 2), 'utf-8');
    console.log(`✅ [region=${region}] 산출물: ${outPath} (기사 ${curated.length}건)`);
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
      content: sanitizeHanja(selection.content) || null,
    }, { onConflict: 'week_of' })
    .select('id')
    .single();
  if (bErr) throw new Error(bErr.message);

  // 새 point를 먼저 계산. 비어 있으면(DeepSeek가 헤드라인을 못 주면) 기존 point를
  // 지우지 않고 유지 — 빈 상태로 덮어쓰는 최악을 피한다.
  const points = toPoints(briefing.id, selection);
  if (points.length === 0) {
    console.warn('⚠️ 선정된 헤드라인 0건 — 기존 point 유지, 갱신 스킵');
  } else {
    // 재실행 멱등: 기존 point 삭제 후 재삽입. delete~insert 사이 짧은 공백 구간이
    // 있으나 주간 cron 특성상 허용된다(실패 시 다음 실행에 복구).
    const { error: dErr } = await supabase
      .from('weekly_briefing_points')
      .delete()
      .eq('briefing_id', briefing.id);
    if (dErr) throw new Error(dErr.message);
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
