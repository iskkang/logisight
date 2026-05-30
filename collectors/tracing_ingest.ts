// collectors/tracing_ingest.ts
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
    console.error(`âŒ data/samples/ ë””ë ‰í„°ë¦¬ê°€ ì—†ìŠµë‹ˆë‹¤. ìƒì„± í›„ xlsx íŒŒì¼ì„ ì¶”ê°€í•´ì£¼ì„¸ìš”.`);
    process.exit(1);
  }

  const xlsxFiles = fs.readdirSync(SAMPLES_DIR)
    .filter(f => f.endsWith('.xlsx') || f.endsWith('.xls'));

  if (xlsxFiles.length === 0) {
    console.warn('âš ï¸  data/samples/ì— xlsx íŒŒì¼ì´ ì—†ìŠµë‹ˆë‹¤. ìŠ¤í‚µí•©ë‹ˆë‹¤.');
    return;
  }

  console.log(`ðŸ“‚ ${xlsxFiles.length}ê°œ íŒŒì¼: ${xlsxFiles.join(', ')}`);

  const supabase = getSupabase();
  let totalShipments = 0;
  let totalFlags = 0;

  // â”€â”€ 1. Parse â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const allShipments = xlsxFiles.flatMap(file => {
    const filePath = path.join(SAMPLES_DIR, file);
    console.log(`\nðŸ“„ íŒŒì‹±: ${file}`);
    try {
      const shipments = parseXlsx(filePath);
      console.log(`  â†’ ${shipments.length}ê±´`);
      totalShipments += shipments.length;

      for (const s of shipments) {
        for (const m of s.milestones) {
          if (m.flag) {
            console.warn(`  âš ï¸  í”Œëž˜ê·¸ [${s.shipmentRef}] ${m.milestone}: ${m.flag}`);
            totalFlags++;
          }
        }
      }
      return shipments;
    } catch (err) {
      console.error(`  âŒ íŒŒì‹± ì‹¤íŒ¨: ${(err as Error).message}`);
      return [];
    }
  });

  if (allShipments.length === 0) {
    console.warn('âš ï¸  ìœ íš¨í•œ í™”ë¬¼ ë°ì´í„° ì—†ìŒ.');
    return;
  }

  // â”€â”€ 2. Upsert shipment_legs â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

  console.log(`\nðŸ’¾ shipment_legs upsert: ${legRows.length}ê±´`);
  const { error: legError } = await supabase
    .from('shipment_legs')
    .upsert(legRows, { onConflict: 'shipment_ref,milestone', ignoreDuplicates: false });

  if (legError) {
    console.error('âŒ shipment_legs upsert ì‹¤íŒ¨:', legError.message);
    process.exit(1);
  }
  console.log('âœ… shipment_legs upsert ì™„ë£Œ');

  // â”€â”€ 3. Aggregate â†’ delay_index_weekly â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

  console.log(`\nðŸ“Š delay_index_weekly upsert: ${indexRows.length}ê±´`);
  const { error: idxError } = await supabase
    .from('delay_index_weekly')
    .upsert(indexRows, { onConflict: 'lane_id,week_iso,milestone', ignoreDuplicates: false });

  if (idxError) {
    console.error('âŒ delay_index_weekly upsert ì‹¤íŒ¨:', idxError.message);
    process.exit(1);
  }
  console.log('âœ… delay_index_weekly upsert ì™„ë£Œ');

  console.log(`
â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”
ðŸ“¦ CADI íŠ¸ë ˆì´ì‹± ì¸ì œìŠ¤íŠ¸ ì™„ë£Œ
  íŒŒì¼       : ${xlsxFiles.length}ê°œ
  í™”ë¬¼ ê±´ìˆ˜  : ${totalShipments}ê±´
  í”Œëž˜ê·¸     : ${totalFlags}ê±´
  ì§‘ê³„ ë ˆì½”ë“œ: ${indexRows.length}ê±´
â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”
`);
}

main().catch(err => {
  console.error('âŒ tracing_ingest ì‹¤íŒ¨:', err);
  process.exit(1);
});
