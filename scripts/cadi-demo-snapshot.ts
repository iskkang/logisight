#!/usr/bin/env ts-node
// scripts/cadi-demo-snapshot.ts
// B-demo: pull live tracking data → CADI delay snapshot → insert to DB.
// Run: npx ts-node --project tsconfig.workers.json scripts/cadi-demo-snapshot.ts
//
// Purpose: verify output quality with real 180-container dataset before
//          wiring into the full ETL pipeline (Phase 2 / plan A).

import { createClient } from '@supabase/supabase-js';

// ─── CONFIGURE BELOW ──────────────────────────────────────────────────────────
// TODO: fill in the live tracking API endpoint + token
const TRACKING_API_URL  = process.env.TRACKING_API_URL  ?? '';  // e.g. https://api.mtlship.com/v1/containers
const TRACKING_API_TOKEN = process.env.TRACKING_API_TOKEN ?? '';  // Bearer token / API key
// ──────────────────────────────────────────────────────────────────────────────

// ─── Lane derivation ─────────────────────────────────────────────────────────
// Maps (origin_country, destination_city) → lane_id
// Extend as more OD pairs appear in the data.
function deriveLane(origin: string, destination: string): string | null {
  const dest = destination.toLowerCase();
  const orig = origin.toLowerCase();

  const isKorea = orig.includes('korea') || orig.includes('kr') || orig.includes('incheon') || orig.includes('busan');
  const isChina = orig.includes('china') || orig.includes('cn') || orig.includes('shenzhen') || orig.includes('qingdao');

  const prefix = isKorea ? 'KR' : isChina ? 'CN' : null;
  if (!prefix) return null;

  if (dest.includes('andijan'))              return `${prefix}-ANDIJAN`;
  if (dest.includes('osh'))                  return `${prefix}-OSH`;
  if (dest.includes('bishkek'))              return `${prefix}-BISHKEK`;
  if (dest.includes('chukursay'))            return `${prefix}-CHUKURSAY`;
  if (dest.includes('almaty'))               return `${prefix}-ALMATY`;
  if (dest.includes('malaszewicze') || dest.includes('mała')) return `${prefix}-MALASZEWICZE`;
  return null;
}

// Maps current_segment_name → route_pattern per spec 4절 + user decision B
function deriveRoutePattern(segmentName: string): 'kashi' | 'khorgos' | 'northern' | 'tsr' | null {
  const s = segmentName.toLowerCase();

  // Kashi pattern: Kashgar/Kashi → UZ/KG destinations
  if (s.includes('kashgar') || s.includes('kashi') || s.includes('喀什') ||
      s.includes('osh') || s.includes('kg-uz') || s.includes('kg_uz')) return 'kashi';

  // Northern pattern: Dostyk/Kartaly/Brest/Małaszewicze
  if (s.includes('dostyk') || s.includes('kartaly') || s.includes('brest') ||
      s.includes('malaszewicze') || s.includes('mała')) return 'northern';

  // Khorgos pattern: Khorgos/Altynkol/Horgos → Almaty
  if (s.includes('khorgos') || s.includes('horgos') || s.includes('altynkol') ||
      s.includes('almaty')) return 'khorgos';

  // TSR: Vladivostok
  if (s.includes('vladivostok') || s.includes('владивосток') || s.includes('tsr')) return 'tsr';

  return null;
}

// ETA signal derivation: red = past ETA without ATA, yellow = near ETA, green = on-time/arrived
function deriveSignal(etaFinal: string | null, ataFinal: string | null): 'red' | 'yellow' | 'green' {
  if (!etaFinal) return 'green';
  const eta = new Date(etaFinal);
  const now = new Date();
  if (ataFinal) return 'green'; // arrived
  if (now > eta) return 'red';  // overdue
  const hoursUntilEta = (eta.getTime() - now.getTime()) / 3_600_000;
  if (hoursUntilEta < 48) return 'yellow'; // arriving within 48h
  return 'green';
}

// ─── Raw API container type ───────────────────────────────────────────────────
interface RawContainer {
  container_no:         string;   // internal key (never exposed)
  origin:               string;
  destination:          string;
  current_location:     string;
  lat:                  number | null;
  lng:                  number | null;
  signal:               string | null;
  eta_final:            string | null;
  ata_final:            string | null;
  current_segment_name: string;
  transport_mode:       string;   // Rail | SEA+RAIL+TRUCK | TRUCK
  load_type:            string;   // FCL | LCL
}

// ─── Aggregation helpers ──────────────────────────────────────────────────────
function currentWeekIso(): string {
  const now = new Date();
  const jan4 = new Date(now.getFullYear(), 0, 4);
  const weekNum = Math.ceil(
    (((now.getTime() - jan4.getTime()) / 86_400_000) + jan4.getDay() + 1) / 7
  );
  return `${now.getFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 !== 0 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function p90(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  return s[Math.max(0, Math.ceil(0.9 * s.length) - 1)];
}
function dataQuality(n: number): 'confirmed' | 'provisional' | 'indicative' {
  if (n >= 5) return 'confirmed';
  if (n >= 2) return 'provisional';
  return 'indicative';
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  if (!TRACKING_API_URL || !TRACKING_API_TOKEN) {
    console.error('❌ TRACKING_API_URL / TRACKING_API_TOKEN 환경변수 없음.');
    console.error('   .env.local에 추가 후 재실행하세요.');
    process.exit(1);
  }

  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // ── 1. Fetch live containers ────────────────────────────────────────────────
  console.log(`🌐 Fetching from ${TRACKING_API_URL} …`);
  const res = await fetch(TRACKING_API_URL, {
    headers: { Authorization: `Bearer ${TRACKING_API_TOKEN}` },
  });
  if (!res.ok) throw new Error(`API HTTP ${res.status}`);
  const raw: RawContainer[] = await res.json();
  console.log(`📦 ${raw.length}건 수신`);

  const weekIso = currentWeekIso();

  // ── 2. Map to shipment_legs rows ───────────────────────────────────────────
  let skipped = 0;
  const legs: Record<string, unknown>[] = [];

  for (const c of raw) {
    const laneId       = deriveLane(c.origin, c.destination);
    const routePattern = deriveRoutePattern(c.current_segment_name);
    if (!laneId) {
      console.warn(`  ⚠️  lane 미감지: ${c.origin} → ${c.destination} (container ${c.container_no.slice(0, 6)}***)`);
      skipped++;
      continue;
    }

    // Delay in hours (ata_final − eta_final for completed; now − eta_final for overdue)
    let delayHours: number | null = null;
    if (c.eta_final && c.ata_final) {
      delayHours = (new Date(c.ata_final).getTime() - new Date(c.eta_final).getTime()) / 3_600_000;
    } else if (c.eta_final && !c.ata_final) {
      const overdue = (Date.now() - new Date(c.eta_final).getTime()) / 3_600_000;
      if (overdue > 0) delayHours = overdue; // in-transit delay
    }

    // Anonymize: strip real container no., keep first 4 chars + file reference
    const shipmentRef = `live:${c.container_no.slice(0, 4)}***:${laneId}`;

    legs.push({
      lane_id:          laneId,
      shipment_ref:     shipmentRef,
      week_iso:         weekIso,
      route_pattern:    routePattern,
      destination:      c.destination,
      milestone:        'DEST_ARR',          // primary milestone for total T/T
      planned_at:       c.eta_final,
      actual_at:        c.ata_final ?? null,
      delay_hours:      delayHours != null ? Math.round(delayHours * 10) / 10 : null,
      current_loc:      c.current_location,
      signal:           deriveSignal(c.eta_final, c.ata_final),
      transport_mode:   c.transport_mode,
      load_type:        c.load_type,
      data_source:      'tracing',
    });
  }

  console.log(`\n✅ ${legs.length}건 매핑됨 / ${skipped}건 스킵 (lane 미감지)`);

  // ── 3. Upsert shipment_legs ────────────────────────────────────────────────
  const { error: legErr } = await supabase
    .from('shipment_legs')
    .upsert(legs, { onConflict: 'shipment_ref,milestone', ignoreDuplicates: false });
  if (legErr) { console.error('❌ shipment_legs upsert 실패:', legErr.message); process.exit(1); }
  console.log('💾 shipment_legs upsert 완료');

  // ── 4. Aggregate → delay_index_weekly ─────────────────────────────────────
  const buckets = new Map<string, { laneId: string; route: string | null; delays: number[] }>();
  for (const leg of legs) {
    const d = leg.delay_hours as number | null;
    if (d === null) continue;
    const key = `${leg.lane_id}|${leg.route_pattern ?? ''}`;
    if (!buckets.has(key)) buckets.set(key, { laneId: leg.lane_id as string, route: leg.route_pattern as string | null, delays: [] });
    buckets.get(key)!.delays.push(d);
  }

  const indexRows: Record<string, unknown>[] = [];
  for (const [, b] of buckets) {
    const n = b.delays.length;
    indexRows.push({
      lane_id:        b.laneId,
      week_iso:       weekIso,
      milestone:      'DEST_ARR',
      route_pattern:  b.route,
      on_time_rate:   b.delays.filter(h => h <= 0).length / n,
      median_delay_h: Math.round(median(b.delays) * 10) / 10,
      p90_delay_h:    Math.round(p90(b.delays) * 10) / 10,
      sample_count:   n,
      data_quality:   dataQuality(n),
      updated_at:     new Date().toISOString(),
    });
  }

  const { error: idxErr } = await supabase
    .from('delay_index_weekly')
    .upsert(indexRows, { onConflict: 'lane_id,week_iso,milestone', ignoreDuplicates: false });
  if (idxErr) { console.error('❌ delay_index_weekly upsert 실패:', idxErr.message); process.exit(1); }

  // ── 5. Print snapshot ──────────────────────────────────────────────────────
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`📊 CADI Snapshot — ${weekIso} (n=${legs.length})`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`${'Lane'.padEnd(22)} ${'n'.padStart(3)} ${'Med(d)'.padStart(7)} ${'P90(d)'.padStart(7)} ${'OTP%'.padStart(6)}  Quality`);
  console.log('─'.repeat(60));

  for (const r of indexRows.sort((a, b) => String(a.lane_id).localeCompare(String(b.lane_id)))) {
    const med  = ((r.median_delay_h as number) / 24).toFixed(1);
    const p90v = ((r.p90_delay_h    as number) / 24).toFixed(1);
    const otp  = ((r.on_time_rate   as number) * 100).toFixed(0);
    console.log(
      `${String(r.lane_id).padEnd(22)} ${String(r.sample_count).padStart(3)}` +
      ` ${(med >= '0' ? '+' : '') + med + 'd'.padStart(7)}` +
      ` ${(p90v >= '0' ? '+' : '') + p90v + 'd'.padStart(7)}` +
      ` ${otp.padStart(5)}%  ${r.data_quality}`
    );
  }
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  // Print red-signal containers (병목 핫스팟)
  const redOnes = legs.filter(l => l.signal === 'red');
  console.log(`\n🔴 Red-signal containers: ${redOnes.length}건`);
  const redByLoc = new Map<string, number>();
  for (const r of redOnes) {
    const loc = String(r.current_loc ?? 'unknown');
    redByLoc.set(loc, (redByLoc.get(loc) ?? 0) + 1);
  }
  for (const [loc, cnt] of [...redByLoc.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)) {
    console.log(`   ${loc}: ${cnt}건`);
  }
}

main().catch(err => {
  console.error('❌ demo-snapshot 실패:', err);
  process.exit(1);
});
