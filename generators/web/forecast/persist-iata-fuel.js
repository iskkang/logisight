'use strict';
// T1-2: 주간 IATA Jet Fuel Price Monitor 헤드라인 → iata_jet_fuel_weekly 적재.
// 실행: node generators/web/forecast/persist-iata-fuel.js (또는 npm run forecast:iata-fuel)
// 출처: IATA / S&P Global Platts (https://www.iata.org/en/publications/economics/fuel-monitor/)
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env.local') });
if (typeof globalThis.WebSocket === 'undefined') { try { globalThis.WebSocket = require('ws'); } catch (_) {} }

const { persistIataReading } = require('./inputs/iata-jet-fuel');

async function main() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE 환경변수 없음');
  }
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false }, realtime: { enabled: false },
  });
  const r = await persistIataReading(sb);
  if (r.ok) {
    const wow = r.fuel_wow_pct != null ? `${r.fuel_wow_pct > 0 ? '+' : ''}${r.fuel_wow_pct}% WoW` : 'WoW n/a';
    console.log(`✅ IATA jet fuel 적재: ${r.as_of} $${r.price_usd_bbl}/bbl (${wow})`);
  } else {
    console.error(`❌ IATA jet fuel 적재 실패: ${r.reason}`);
    process.exit(1);
  }
}

main().catch((e) => { console.error('iata-fuel persist 실패:', e.message); process.exit(1); });
