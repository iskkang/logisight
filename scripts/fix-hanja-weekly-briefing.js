// scripts/fix-hanja-weekly-briefing.js
// 기존 weekly_briefings.content · weekly_briefing_points.headline 의 어려운 한자 약물을
// 결정론적 sanitizeHanja 로 정리(LLM 불필요). 기본 dry-run, --apply 로 실제 갱신.
// 실행: node scripts/fix-hanja-weekly-briefing.js [--apply]
'use strict';

const path = require('path');
const ws = require('ws');
globalThis.WebSocket = ws;
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: path.resolve(__dirname, '../.env.local') });
const { sanitizeHanja } = require('../generators/web/lib/weekly-briefing.lib');

const APPLY = process.argv.includes('--apply');

async function main() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_URL 또는 SUPABASE_SERVICE_ROLE_KEY 없음');
  }
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false }, realtime: { enabled: false },
  });

  let changed = 0;

  // 1) 헤드라인
  const { data: points, error: pErr } = await sb
    .from('weekly_briefing_points').select('id,headline');
  if (pErr) throw new Error(pErr.message);
  for (const p of points || []) {
    const fixed = sanitizeHanja(p.headline);
    if (fixed !== p.headline) {
      changed++;
      console.log(`[headline ${p.id}]\n  - ${p.headline}\n  + ${fixed}`);
      if (APPLY) {
        const { error } = await sb.from('weekly_briefing_points').update({ headline: fixed }).eq('id', p.id);
        if (error) console.error(`  ❌ ${error.message}`);
      }
    }
  }

  // 2) 본문
  const { data: briefs, error: bErr } = await sb
    .from('weekly_briefings').select('id,content');
  if (bErr) throw new Error(bErr.message);
  for (const b of briefs || []) {
    if (!b.content) continue;
    const fixed = sanitizeHanja(b.content);
    if (fixed !== b.content) {
      changed++;
      console.log(`[content ${b.id}] 변경 (${b.content.length}자)`);
      if (APPLY) {
        const { error } = await sb.from('weekly_briefings').update({ content: fixed }).eq('id', b.id);
        if (error) console.error(`  ❌ ${error.message}`);
      }
    }
  }

  console.log(`\n${APPLY ? '✅ 적용' : '🔍 dry-run'}: 변경 대상 ${changed}건${APPLY ? ' 갱신 완료' : ' (--apply 로 반영)'}`);
}

main().catch((e) => { console.error('❌ 실패:', e.message); process.exit(1); });
