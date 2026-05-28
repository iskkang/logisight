import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import ws from 'ws';
(globalThis as any).WebSocket = ws;

// scripts/snapshot-tcr.ts
// MTL Link TCR API → 익명 집계 → tcr_snapshots 일별 1행 upsert
//
// 실행: npx tsx scripts/snapshot-tcr.ts
// daily 워크플로우에 추가하면 "이번주 vs 지난주 운송량" 추이 제공 가능

import { createClient } from '@supabase/supabase-js';
import { fetchTcrLive, aggregateTcr } from '../lib/tcr-live';

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('❌ SUPABASE_URL 또는 SUPABASE_SERVICE_ROLE_KEY 없음');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
  realtime: { enabled: false } as never,
});

async function main() {
  console.log('🌐 MTL Link TCR API 호출...');
  const containers = await fetchTcrLive();
  console.log(`📦 ${containers.length}건 수신`);

  const agg  = aggregateTcr(containers);
  const today = new Date().toISOString().slice(0, 10);

  const { error } = await supabase
    .from('tcr_snapshots')
    .upsert({
      snapshot_date:  today,
      total:          agg.total,
      in_transit:     agg.inTransitCount,
      arrived:        agg.arrivedCount,
      alert_count:    agg.alertCount,
      by_destination: agg.byDestination,
      by_segment:     agg.bySegment,
    }, { onConflict: 'snapshot_date' });

  if (error) {
    console.error('❌ upsert 실패:', error.message);
    process.exit(1);
  }

  console.log(`✅ tcr_snapshots upsert 완료 — ${today}`);
  console.log(`   운송중: ${agg.inTransitCount} / 도착: ${agg.arrivedCount} / 지연주의: ${agg.alertCount}`);
}

main().catch(e => { console.error(e); process.exit(1); });
