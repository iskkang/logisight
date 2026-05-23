// workers/collectors/tracing_ingest.ts
// Reads xlsx files from data/samples/, parses milestones, upserts to Supabase.
// Run: npm run collect:tracing
// Idempotent: UNIQUE constraints on (shipment_ref, milestone) and (lane_id, week_iso, milestone).

import * as fs from 'fs';
import * as path from 'path';
import { createClient } from '@supabase/supabase-js';
import {
  parseXlsx,
  aggregateWeekly,
  median,
  p90,
  dataQuality,
  type MilestoneCode,
} from './utils/xlsx_parser';

const SAMPLES_DIR = path.resolve(process.cwd(), 'data', 'samples');

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment');
  }
  return createClient(url, key);
}

async function main() {
  if (!fs.existsSync(SAMPLES_DIR)) {
    console.error(`❌ data/samples/ 디렉터리가 없습니다. 생성 후 xlsx 파일을 추가해주세요.`);
    process.exit(1);
  }

  const xlsxFiles = fs.readdirSync(SAMPLES_DIR)
    .filter(f => f.endsWith('.xlsx') || f.endsWith('.xls'));

  if (xlsxFiles.length === 0) {
    console.warn('⚠️  data/samples/에 xlsx 파일이 없습니다. 스킵합니다.');
    return;
  }

  console.log(`📂 ${xlsxFiles.length}개 파일: ${xlsxFiles.join(', ')}`);

  const supabase = getSupabase();
  let totalShipments = 0;
  let totalFlags = 0;

  // ── 1. Parse ───────────────────────────────────────────────────────────────
  const allShipments = xlsxFiles.flatMap(file => {
    const filePath = path.join(SAMPLES_DIR, file);
    console.log(`\n📄 파싱: ${file}`);
    try {
      const shipments = parseXlsx(filePath);
      console.log(`  → ${shipments.length}건`);
      totalShipments += shipments.length;

      for (const s of shipments) {
        for (const m of s.milestones) {
          if (m.flag) {
            console.warn(`  ⚠️  플래그 [${s.shipmentRef}] ${m.milestone}: ${m.flag}`);
            totalFlags++;
          }
        }
      }
      return shipments;
    } catch (err) {
      console.error(`  ❌ 파싱 실패: ${(err as Error).message}`);
      return [];
    }
  });

  if (allShipments.length === 0) {
    console.warn('⚠️  유효한 화물 데이터 없음.');
    return;
  }

  // ── 2. Upsert shipment_legs ────────────────────────────────────────────────
  const legRows = allShipments.flatMap(s =>
    s.milestones.map(m => ({
      lane_id:       s.laneId,
      shipment_ref:  s.shipmentRef,
      week_iso:      s.weekIso,
      route_pattern: s.routePattern,   // 'kashi'|'khorgos'|'tsr'|null
      destination:   s.destination,    // 'Andijan'|'Almaty'|...
      milestone:     m.milestone as string,
      planned_at:    m.plannedAt,
      actual_at:     m.actualAt,
      delay_hours:   m.delayHours,
      flag:          m.flag,
      raw_source_file: s.shipmentRef.split(':')[0],
      data_source:   'tracing',
    }))
  );

  console.log(`\n💾 shipment_legs upsert: ${legRows.length}건`);
  const { error: legError } = await supabase
    .from('shipment_legs')
    .upsert(legRows, { onConflict: 'shipment_ref,milestone', ignoreDuplicates: false });

  if (legError) {
    console.error('❌ shipment_legs upsert 실패:', legError.message);
    process.exit(1);
  }
  console.log('✅ shipment_legs upsert 완료');

  // ── 3. Aggregate → delay_index_weekly ─────────────────────────────────────
  const buckets = aggregateWeekly(allShipments);
  const indexRows: Array<{
    lane_id:       string;
    week_iso:      string;
    milestone:     MilestoneCode;
    route_pattern: 'kashi' | 'khorgos' | 'tsr' | null;
    destination:   string | null;
    median_delay_h: number;
    p90_delay_h:   number;
    on_time_rate:  number;
    sample_count:  number;
    data_quality:  string;
    updated_at:    string;
  }> = [];

  for (const [, bucket] of buckets) {
    const n = bucket.delayHours.length;
    indexRows.push({
      lane_id:       bucket.laneId,
      week_iso:      bucket.weekIso,
      milestone:     bucket.milestone,
      route_pattern: bucket.routePattern,
      destination:   bucket.destination,
      median_delay_h: Math.round(median(bucket.delayHours) * 10) / 10,
      p90_delay_h:   Math.round(p90(bucket.delayHours) * 10) / 10,
      on_time_rate:  Math.round((bucket.delayHours.filter(h => h <= 0).length / n) * 1000) / 1000,
      sample_count:  n,
      data_quality:  dataQuality(n),
      updated_at:    new Date().toISOString(),
    });
  }

  console.log(`\n📊 delay_index_weekly upsert: ${indexRows.length}건`);
  const { error: idxError } = await supabase
    .from('delay_index_weekly')
    .upsert(indexRows, { onConflict: 'lane_id,week_iso,milestone', ignoreDuplicates: false });

  if (idxError) {
    console.error('❌ delay_index_weekly upsert 실패:', idxError.message);
    process.exit(1);
  }
  console.log('✅ delay_index_weekly upsert 완료');

  console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📦 CADI 트레이싱 인제스트 완료
  파일       : ${xlsxFiles.length}개
  화물 건수  : ${totalShipments}건
  플래그     : ${totalFlags}건
  집계 레코드: ${indexRows.length}건
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);
}

main().catch(err => {
  console.error('❌ tracing_ingest 실패:', err);
  process.exit(1);
});
