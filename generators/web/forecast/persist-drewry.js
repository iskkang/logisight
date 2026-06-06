'use strict';
// Wave 1.5: 주간 Drewry 결항 헤드라인 → blank_sailings(region='Drewry East-West') 적재.
// 실행: node generators/web/forecast/persist-drewry.js (또는 npm run forecast:drewry)
// generate 이전에 돌려 supply tracker_quoted 소스를 최신화한다.
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env.local') });
if (typeof globalThis.WebSocket === 'undefined') { try { globalThis.WebSocket = require('ws'); } catch (_) {} }

const { persistDrewryReading } = require('./inputs/drewry-blank');

async function main() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('SUPABASE 환경변수 없음');
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false }, realtime: { enabled: false },
  });
  const r = await persistDrewryReading(sb);
  if (r.ok) console.log(`✅ Drewry 적재: ${r.as_of} ${r.pct}% (${r.blank}/${r.scheduled}편)`);
  else { console.error(`❌ Drewry 적재 실패: ${r.reason}`); process.exit(1); }
}

main().catch((e) => { console.error('drewry persist 실패:', e.message); process.exit(1); });
