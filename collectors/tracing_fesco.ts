// collectors/tracing_fesco.ts
// Phase 2 ETL — TSR/FESCO tracking API (GET, no-auth currently)
//
// Run: npm run collect:tsr
//
// Security: container_number + order_number stripped (SHA-256 anonymized).
//           No customer name fields present in FESCO API — nothing to strip.
//
// Design (CLAUDE.md Karpathy):
//  - route_pattern = 'tsr' ALWAYS — fixed per source, never inferred from destination
//  - Planned/actual dates: SEA segment (Busan→Vladivostok) has reliable dates;
//    final RR segment dates are null in current dataset → use SEA leg for delay calc
//  - Bottleneck detection: display_location_text contains VMTP/Vladivostok → SEA_TS_ARR
//  - Failure recorded as is_complete=false (not dropped silently)

import { createHash } from 'crypto';

// Supabase REST helpers — no Realtime dependency (Node 20 compat, no ws needed)
const SUPABASE_URL = process.env.SUPABASE_URL ?? '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

async function sbUpsert(
  table: string,
  rows: Record<string, unknown>[],
  onConflict: string
): Promise<void> {
  if (!rows.length) return;
  const url = `${SUPABASE_URL}/rest/v1/${table}?on_conflict=${encodeURIComponent(onConflict)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      apikey:          SUPABASE_KEY,
      Authorization:   `Bearer ${SUPABASE_KEY}`,
      'Content-Type':  'application/json',
      Prefer:          'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify(rows),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase REST ${table} upsert failed: ${res.status} — ${text}`);
  }
}

const API_URL   = 'https://mtl-link.vercel.app/api/fesco/containers?limit=500';
const API_TOKEN = process.env.TRACKING_API_TOKEN ?? '';  // empty = no auth (current state)

// ─── Lane derivation ──────────────────────────────────────────────────────────
// origin_city = "Busan" → prefix KR; others treated as CN
function deriveLane(originCity: string, destinationCity: string): string | null {
  const dest = (destinationCity ?? '').toLowerCase().trim();
  const orig = (originCity ?? '').toLowerCase().trim();

  const isKorea = orig.includes('busan') || orig.includes('incheon') || orig.includes('korea') || orig === 'kr';
  const isChina = orig.includes('shenzhen') || orig.includes('qingdao') || orig.includes('china') || orig === 'cn';
  if (!isKorea && !isChina) return null;
  const prefix = isKorea ? 'KR' : 'CN';

  if (dest.includes('andijan'))                                return `${prefix}-ANDIJAN`;
  if (dest.includes('osh'))                                    return `${prefix}-OSH`;
  if (dest.includes('bishkek'))                                return `${prefix}-BISHKEK`;
  if (dest.includes('chukursay') || dest.includes('chukursaj')) return `${prefix}-CHUKURSAY`;
  if (dest.includes('almaty'))                                 return `${prefix}-ALMATY`;
  if (dest.includes('mała') || dest.includes('malaszewicze')) return `${prefix}-MALASZEWICZE`;
  if (dest.includes('tashkent') || dest.includes('toshkent')) return `${prefix}-TASHKENT`;
  return null;
}

// ─── Milestone derivation ─────────────────────────────────────────────────────
// TSR-specific: Vladivostok/VMTP = SEA→rail handoff point (primary bottleneck)
function deriveCurrentMilestone(
  displayLoc: string | null,
  operationalStatus: string | null,
  arrived: boolean
): string {
  if (arrived) return 'DEST_ARR';

  const disp = (displayLoc ?? '').toLowerCase();

  // Stuck at Vladivostok transhipment point (sea-to-rail)
  if (disp.includes('vmtp') || disp.includes('vladivostok') || disp.includes('vvo')) {
    return 'SEA_TS_ARR';
  }
  // On the rail leg or beyond
  if (operationalStatus === 'in_progress') return 'DEST_ARR';  // rolling toward dest

  return 'DEST_ARR';  // default bucket for T/T aggregation
}

// ─── Week ISO from a date string ──────────────────────────────────────────────
// ISO 8601: week 1 = the week containing the first Thursday of the year (Mon start).
function toWeekIso(dateStr: string | null): string {
  const d = dateStr ? new Date(dateStr) : new Date();
  if (isNaN(d.getTime())) return toWeekIso(null);
  const day      = d.getUTCDay() === 0 ? 7 : d.getUTCDay(); // 1=Mon … 7=Sun
  const thursday = new Date(d);
  thursday.setUTCDate(d.getUTCDate() + 4 - day);            // Thursday of same ISO week
  const yearStart = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 1));
  const weekNo    = Math.ceil(((thursday.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${thursday.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

// ─── Stats helpers ────────────────────────────────────────────────────────────
function median(v: number[]): number {
  const s = [...v].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 !== 0 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function p90(v: number[]): number {
  const s = [...v].sort((a, b) => a - b);
  return s[Math.max(0, Math.ceil(0.9 * s.length) - 1)];
}
function dataQuality(n: number): 'confirmed' | 'provisional' | 'indicative' {
  return n >= 5 ? 'confirmed' : n >= 2 ? 'provisional' : 'indicative';
}

// ─── Raw API types ────────────────────────────────────────────────────────────
interface FescoSegment {
  id:                    string;
  segmentType:           string;   // 'SEA' | 'RR' | etc.
  completed:             boolean;
  inProgress:            boolean;
  currentSegment:        boolean;
  departureDate:         string | null;
  destinationDate:       string | null;        // actual arrival at segment dest
  planingDepartureDate:  string | null;
  planingDestinationDate: string | null;       // planned arrival at segment dest
  destinationLocationEn: string | null;
  departureLocationEn:   string | null;
  containerNumber:       string;               // ⛔ STRIP — same as container_number
}

interface FescoContainer {
  container_number:    string;        // ⛔ STRIP — anonymize via SHA-256
  order_number:        string;        // ⛔ STRIP — internal only
  operational_status:  string | null;
  origin_city:         string;
  destination_city:    string;
  destination_country_code: string | null;
  display_location_text: string | null;   // current physical location (shows VMTP)
  current_location_text: string | null;   // logical destination city
  display_latitude:    number | null;
  display_longitude:   number | null;
  eta:                 string | null;    // top-level ETA (usually null for FESCO)
  signal:              string | null;    // green | yellow | red | unknown
  open_alert_count:    number;
  open_alert_types:    string[];
  current_segment_type: string | null;
  segments:            FescoSegment[];
}

interface ApiResponse {
  ok:    boolean;
  total: number;
  data:  FescoContainer[];
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY env missing.');
    process.exit(1);
  }

  // ── 1. Fetch FESCO API ──────────────────────────────────────────────────────
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (API_TOKEN) headers['Authorization'] = `Bearer ${API_TOKEN}`;

  console.log(`Fetching ${API_URL} ...`);
  const res = await fetch(API_URL, { headers });
  if (!res.ok) throw new Error(`API HTTP ${res.status} — ${await res.text()}`);

  const payload = await res.json() as ApiResponse;
  if (!payload.ok) throw new Error(`API returned ok=false`);
  const containers = payload.data ?? [];
  console.log(`${containers.length} containers received (API total: ${payload.total})`);

  // ── 2. Map → shipment_legs ─────────────────────────────────────────────────
  let skipped = 0;
  const legRows: Record<string, unknown>[] = [];

  for (const c of containers) {
    if (!c.origin_city || !c.destination_city) { skipped++; continue; }

    const laneId = deriveLane(c.origin_city, c.destination_city);
    if (!laneId) {
      console.warn(`  lane not detected: ${c.origin_city} -> ${c.destination_city}`);
      skipped++;
      continue;
    }

    // Determine if container has arrived (no arrived/delivered status in current dataset,
    // but guard for future data)
    const arrived = c.operational_status === 'arrived' || c.operational_status === 'delivered';

    // Planned/actual dates: use SEA segment (most reliable dates in current data).
    // The final RR segment dates are null for all in-transit containers.
    // If SEA segment has both, use for delay calc; if only planned, use for overdue calc.
    const seaSeg = c.segments.find(s => s.segmentType === 'SEA');
    const plannedDate = seaSeg?.planingDestinationDate ?? null;   // planned VVO arrival
    const actualDate  = seaSeg?.destinationDate ?? null;          // actual VVO arrival

    // Delay calculation (hours) — measures sea-leg punctuality (Vladivostok handoff)
    let delayHours: number | null = null;
    if (plannedDate && actualDate) {
      // Completed sea leg: actual − planned
      delayHours = (new Date(actualDate).getTime() - new Date(plannedDate).getTime()) / 3_600_000;
    } else if (plannedDate && !actualDate && c.signal === 'red') {
      // Overdue: now − planned VVO arrival
      const overdueMsec = Date.now() - new Date(plannedDate).getTime();
      if (overdueMsec > 0) delayHours = overdueMsec / 3_600_000;
    }

    // Week ISO — use actual VVO date if available, else planned, else current week
    const weekIso = toWeekIso(actualDate ?? plannedDate);

    const milestone = deriveCurrentMilestone(c.display_location_text, c.operational_status, arrived);

    // Anonymize: SHA-256 first 12 hex chars (not reversible)
    const anonRef = `fesco:${createHash('sha256').update(c.container_number).digest('hex').slice(0, 12)}`;

    legRows.push({
      lane_id:       laneId,
      shipment_ref:  anonRef,
      week_iso:      weekIso,
      route_pattern: 'tsr',           // ALWAYS tsr — fixed per source (FESCO = TSR)
      destination:   c.destination_city,
      milestone:     milestone,
      planned_at:    plannedDate ? new Date(plannedDate).toISOString() : null,
      actual_at:     actualDate  ? new Date(actualDate).toISOString()  : null,
      delay_hours:   delayHours !== null ? Math.round(delayHours * 10) / 10 : null,
      current_loc:   c.display_location_text,  // physical location (shows VMTP bottleneck)
      signal:        c.signal,
      transport_mode: c.current_segment_type,
      load_type:     null,
      data_source:   'tracing',  // 'fesco' is not an allowed value; route_pattern='tsr' distinguishes TSR legs
      // ⛔ container_number NOT stored (SHA-256 anonymized above)
      // ⛔ order_number NOT stored (internal only)
      // Memory-only flag: sea leg actual date received (not upserted to DB)
      _is_completed: actualDate !== null,
    });
  }

  console.log(`${legRows.length} rows mapped / ${skipped} skipped`);

  // Strip memory-only fields before DB upsert
  const legRowsForDb = legRows.map(({ _is_completed: _unused, ...rest }) => rest);

  // ── 3. Fetch valid lane IDs from DB (guard against FK violation) ─────────
  const lanesRes = await fetch(`${SUPABASE_URL}/rest/v1/lanes?select=id`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  });
  if (!lanesRes.ok) {
    throw new Error(`Failed to fetch lane IDs: HTTP ${lanesRes.status}`);
  }
  const validLanes: Set<string> = new Set();
  const laneList = await lanesRes.json() as { id: string }[];
  laneList.forEach(l => validLanes.add(l.id));

  // filteredLegs retains _is_completed for aggregation gate; filteredLegsForDb is sent to DB
  const filteredLegs = legRows.filter(leg => {
    if (!validLanes.has(leg.lane_id as string)) {
      console.warn(`  lane "${leg.lane_id}" not in DB — skipping row`);
      return false;
    }
    return true;
  });
  const filteredLegsForDb = legRowsForDb.filter(leg => validLanes.has(leg.lane_id as string));
  console.log(`DB lane filter: ${filteredLegsForDb.length} rows kept (${legRows.length - filteredLegsForDb.length} excluded)`);

  // ── Upsert shipment_legs (service-role only) ──────────────────────────────
  await sbUpsert('shipment_legs', filteredLegsForDb, 'shipment_ref,milestone');
  console.log(`shipment_legs upsert done (${filteredLegsForDb.length} rows)`);

  // ── 4. Aggregate → delay_index_weekly ────────────────────────────────────
  // Key = lane_id|week_iso. route_pattern = 'tsr' always.
  type Bucket = { laneId: string; weekIso: string; delays: number[] };
  const buckets = new Map<string, Bucket>();

  for (const leg of filteredLegs) {
    const d = leg.delay_hours as number | null;
    if (d === null) continue;
    // Only aggregate containers with a completed SEA leg (actual VVO date present)
    // or confirmed overdue red-signal. SEA-in-progress containers are excluded to
    // prevent SEA-leg delays from polluting the total T/T delay bucket.
    const isCompleted = leg._is_completed as boolean;
    const isOverdue   = leg.signal === 'red' && !isCompleted && leg.milestone === 'DEST_ARR';
    if (!isCompleted && !isOverdue) continue;

    const key = `${leg.lane_id}|${leg.week_iso}`;
    if (!buckets.has(key)) {
      buckets.set(key, { laneId: leg.lane_id as string, weekIso: leg.week_iso as string, delays: [] });
    }
    buckets.get(key)!.delays.push(d);
  }

  const indexRows: Record<string, unknown>[] = [];
  for (const [, b] of buckets) {
    const n   = b.delays.length;
    const med = median(b.delays);
    const p   = p90(b.delays);
    const otp = b.delays.filter(h => h <= 0).length / n;
    indexRows.push({
      lane_id:        b.laneId,
      week_iso:       b.weekIso,
      milestone:      'DEST_ARR',
      route_pattern:  'tsr',
      median_delay_h: Math.round(med * 10) / 10,
      p90_delay_h:    Math.round(p * 10) / 10,
      on_time_rate:   Math.round(otp * 1000) / 1000,
      sample_count:   n,
      data_quality:   dataQuality(n),
      updated_at:     new Date().toISOString(),
    });
  }

  if (indexRows.length > 0) {
    await sbUpsert('delay_index_weekly', indexRows, 'lane_id,week_iso,milestone');
    console.log(`delay_index_weekly upsert done (${indexRows.length} rows)`);
  } else {
    console.log('delay_index_weekly: no buckets with delay data (all dates null in current dataset)');
  }

  // ── 5. Print snapshot ─────────────────────────────────────────────────────
  console.log('\n' + '━'.repeat(66));
  console.log(`CADI FESCO/TSR Snapshot — ${containers.length} containers processed`);
  console.log('━'.repeat(66));
  if (indexRows.length > 0) {
    console.log(`${'Lane'.padEnd(22)} ${'Week'.padEnd(9)} ${'n'.padStart(3)} ${'Med(d)'.padStart(8)} ${'P90(d)'.padStart(8)} ${'OTP%'.padStart(6)}  Quality`);
    console.log('─'.repeat(72));
    for (const r of indexRows.sort((a, b) => String(a.lane_id).localeCompare(String(b.lane_id)))) {
      const med  = ((r.median_delay_h as number) / 24).toFixed(1);
      const p90v = ((r.p90_delay_h    as number) / 24).toFixed(1);
      const otp  = ((r.on_time_rate   as number) * 100).toFixed(0);
      const sign = (v: string) => parseFloat(v) >= 0 ? `+${v}d` : `${v}d`;
      console.log(
        `${String(r.lane_id).padEnd(22)} ${String(r.week_iso).padEnd(9)}` +
        ` ${String(r.sample_count).padStart(3)}` +
        ` ${sign(med).padStart(8)}` +
        ` ${sign(p90v).padStart(8)}` +
        ` ${otp.padStart(5)}%  ${r.data_quality}`
      );
    }
  }

  // Vladivostok bottleneck report
  const atVlad = filteredLegsForDb.filter(l =>
    (String(l.current_loc ?? '')).toLowerCase().includes('vmtp') ||
    (String(l.current_loc ?? '')).toLowerCase().includes('vladivostok')
  );
  console.log(`\nVladivostok/VMTP bottleneck containers: ${atVlad.length}`);
  const bySignal = new Map<string, number>();
  for (const l of atVlad) {
    const s = String(l.signal ?? 'unknown');
    bySignal.set(s, (bySignal.get(s) ?? 0) + 1);
  }
  [...bySignal.entries()].sort((a, b) => b[1] - a[1])
    .forEach(([sig, cnt]) => console.log(`   signal=${sig.padEnd(8)} ${cnt} containers`));

  console.log('━'.repeat(66));
  console.log('Security: container_number SHA-256 anonymized. order_number not stored.');
}

main().catch(err => { console.error('tracing_fesco failed:', err); process.exit(1); });
