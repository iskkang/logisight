'use strict';
// 격주 freshness 체크: red_sea_diversion 최신 행이 14일 이내인지 확인.
// Drewry Red Sea Diversion Tracker 어드민 수동 입력이 누락된 경우 경보.
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env.local') });
if (typeof globalThis.WebSocket === 'undefined') { try { globalThis.WebSocket = require('ws'); } catch (_) {} }

const { fetchDiversion } = require('./inputs/diversion');

async function main() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE 환경변수 없음');
  }
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false }, realtime: { enabled: false },
  });
  const asof = new Date();
  const r = await fetchDiversion(sb, asof);
  if (!r) {
    console.error('❌ red_sea_diversion: 데이터 없음 — 어드민 입력 필요 (Drewry Red Sea Diversion Tracker)');
    process.exit(1);
  }
  if (r.signal_age_days > 14) {
    console.error(`❌ red_sea_diversion: 마지막 입력 ${r.signal_age_days}일 전 (${r.as_of}) — 14일 초과, 어드민 업데이트 필요`);
    process.exit(1);
  }
  console.log(`✅ red_sea_diversion 최신: ${r.as_of} | 케이프 ${r.cape_share_pct}% | cap_chg ${r.effective_capacity_chg_pct}% | ${r.signal_age_days}일 전`);
}

main().catch((e) => { console.error('diversion check 실패:', e.message); process.exit(1); });
