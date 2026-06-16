'use strict';
// Wave 1.5: 주간 Drewry 결항 헤드라인 → blank_sailings(region='Drewry East-West') 적재.
// 실행: node generators/web/forecast/persist-drewry.js (또는 npm run forecast:drewry)
// generate 이전에 돌려 supply tracker_quoted 소스를 최신화한다.
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env.local') });
if (typeof globalThis.WebSocket === 'undefined') { try { globalThis.WebSocket = require('ws'); } catch (_) {} }

const { persistDrewryReading, DREWRY_REGION } = require('./inputs/drewry-blank');

async function main() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('SUPABASE 환경변수 없음');
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false }, realtime: { enabled: false },
  });
  const r = await persistDrewryReading(sb);
  if (r.ok) {
    console.log(`✅ Drewry 적재: ${r.as_of} ${r.pct}% (${r.blank}/${r.scheduled}편)`);
    return;
  }
  // 수집 실패는 비치명적: 직전 적재값(carry-forward)을 유지하고 종료. 직전 기록이 없을 때만 실패.
  console.warn(`⚠️ Drewry 수집 실패: ${r.reason} — 직전 값 carry-forward`);
  const { data: last, error } = await sb
    .from('blank_sailings')
    .select('week_start, blank_pct, blanked_teu')
    .eq('region', DREWRY_REGION)
    .order('week_start', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) { console.error(`❌ carry-forward 조회 실패: ${error.message}`); process.exit(1); }
  if (!last) { console.error('❌ carry-forward 불가: 직전 Drewry 적재 기록 없음'); process.exit(1); }
  console.log(`↪︎ carry-forward: ${last.week_start} ${last.blank_pct}% (${last.blanked_teu}편) 유지`);
}

main().catch((e) => { console.error('drewry persist 실패:', e.message); process.exit(1); });
