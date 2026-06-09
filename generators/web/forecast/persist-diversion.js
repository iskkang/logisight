'use strict';
// IMF Portwatch → red_sea_diversion 테이블 upsert.
// 실행: node generators/web/forecast/persist-diversion.js (또는 npm run forecast:diversion)
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env.local') });
if (typeof globalThis.WebSocket === 'undefined') { try { globalThis.WebSocket = require('ws'); } catch (_) {} }

const { fetchAndBuildDiversion } = require('./inputs/portwatch-diversion');

async function main() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE 환경변수 없음');
  }
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false }, realtime: { enabled: false },
  });
  const periods = await fetchAndBuildDiversion();
  if (!periods || !periods.length) {
    console.error('❌ diversion: IMF Portwatch 데이터 미수집');
    process.exit(1);
  }
  for (const d of periods) {
    const row = {
      as_of: d.as_of,
      cape_share_pct: d.cape_share_pct,
      suez_share_pct: d.suez_share_pct,
      source: d.source,
      note: `avg ${d.current_avg}/day vs baseline ${d.baseline}/day`,
    };
    const { error } = await sb.from('red_sea_diversion').upsert(row, { onConflict: 'as_of' });
    if (error) {
      console.error('❌ diversion upsert 실패:', error.message);
      process.exit(1);
    }
  }
  const d = periods[0];
  console.log(
    `✅ diversion 적재: ${d.as_of} 케이프 ${d.cape_share_pct}% (avg ${d.current_avg} vs baseline ${d.baseline}) [${periods.length}행]`,
  );
}

main().catch((e) => { console.error('diversion persist 실패:', e.message); process.exit(1); });
