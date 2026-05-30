// collectors/tracing_live.ts
// Phase 2 ETL â€” 1ì°¨ ì†ŒìŠ¤: MTL Link live tracking API (GET, no-auth currently)
//
// Run: npm run collect:live
//
// âš ï¸ ë³´ì•ˆ ì£¼ì˜: í˜„ìž¬ API ë¬´ì¸ì¦ â†’ customer_list ë“± PII ë¯¸ì €ìž¥ ì²˜ë¦¬.
//    MTL Link íŒ€ì— read í† í° ì ìš© ê¶Œê³ . ì ìš© ì‹œ TRACKING_API_TOKEN env ì‚¬ìš©.
//
// ì„¤ê³„ ì›ì¹™ (CLAUDE.md Karpathy):
//  - ì†ŒìŠ¤ ì–´ëŒ‘í„° ì¶”ìƒí™” ê¸ˆì§€ â€” ì´ APIë§Œ ì§ì ‘ fetch
//  - ì €ìž¥ ê¸ˆì§€: customer_list, í™”ë¬¼ ë©”ëª¨
//  - container_no = ë‚´ë¶€ upsert í‚¤ (service-role RLS â†’ ì™¸ë¶€ ë¯¸ë…¸ì¶œ)
//  - ë°œí–‰ê°’ = ì§‘ê³„ì¹˜ë§Œ (delay_index_weekly)

import { createHash } from 'crypto';

// Supabase REST helpers â€” no Realtime dependency (Node 20 compat, no ws needed)
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
    throw new Error(`Supabase REST ${table} upsert failed: ${res.status} â€” ${text}`);
  }
}

const API_URL   = process.env.TRACKING_API_URL   ?? 'https://link.mtlship.com/api/tcr?action=list';
const API_TOKEN = process.env.TRACKING_API_TOKEN ?? '';  // empty = no auth (current state)

// â”€â”€â”€ Lane derivation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Maps (origin_city, destination_city) â†’ lane_id matching DB seed (migration 003)
function deriveLane(origin: string, destination: string): string | null {
  const dest = (destination ?? '').toLowerCase().trim();
  const orig = (origin ?? '').toLowerCase().trim();

  // Origin prefix
  const isKorea   = orig.includes('incheon') || orig.includes('busan') || orig.includes('korea') || orig === 'kr';
  const isChina   = orig.includes('shenzhen') || orig.includes('qingdao') || orig.includes('china') || orig === 'cn';
  if (!isKorea && !isChina) return null;
  const prefix = isKorea ? 'KR' : 'CN';

  if (dest.includes('andijan'))                                 return `${prefix}-ANDIJAN`;
  if (dest.includes('osh'))                                     return `${prefix}-OSH`;
  if (dest.includes('bishkek'))                                 return `${prefix}-BISHKEK`;
  if (dest.includes('chukursay'))                               return `${prefix}-CHUKURSAY`;
  if (dest.includes('almaty'))                                  return `${prefix}-ALMATY`;
  if (dest.includes('maÅ‚a') || dest.includes('malaszewicze'))   return `${prefix}-MALASZEWICZE`;
  if (dest.includes('tashkent') || dest.includes('toshkent'))  return `${prefix}-TASHKENT`;   // future lane
  return null;
}

// â”€â”€â”€ Route pattern derivation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Derived from current_segment_name (priority), then destination, then location.
// enum: kashi | khorgos | northern | tsr
function deriveRoutePattern(
  segmentName: string | null,
  destination: string,
  currentLoc: string | null
): 'kashi' | 'khorgos' | 'northern' | 'tsr' | null {
  const seg  = (segmentName ?? '').toLowerCase();
  const dest = (destination ?? '').toLowerCase();
  const loc  = (currentLoc ?? '').toLowerCase();

  // Kashi pattern signals
  if (seg.includes('kashgar') || seg.includes('kashi')    ||
      seg.includes('â†’ andijan') || seg.includes('â†’ osh')  ||
      seg.includes('â†’ bishkek') || loc.includes('kashgar') ||
      loc.includes('kashi'))  return 'kashi';

  // Northern pattern: Dostyk / Kartaly / Brest / MaÅ‚aszewicze
  if (seg.includes('dostyk')  || seg.includes('kartaly')  ||
      seg.includes('brest')   || seg.includes('maÅ‚a')      ||
      loc.includes('dostuk')  || loc.includes('dostyk'))   return 'northern';

  // Khorgos pattern
  if (seg.includes('khorgos') || seg.includes('horgos')   ||
      seg.includes('altynkol') || loc.includes('khorgos')) return 'khorgos';

  // TSR: Vladivostok
  if (seg.includes('vladivostok') || seg.includes('tsr'))  return 'tsr';

  // Fallback from destination
  if (dest.includes('andijan') || dest.includes('osh') || dest.includes('bishkek') ||
      dest.includes('chukursay') || dest.includes('tashkent')) return 'kashi';
  if (dest.includes('almaty'))                             return 'khorgos';
  if (dest.includes('maÅ‚a') || dest.includes('malaszewicze')) return 'northern';

  return null;
}

// â”€â”€â”€ Milestone derivation from current position â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Single milestone per container (current state), primary key = DEST_ARR for aggregation
function deriveCurrentMilestone(
  segmentName: string | null,
  currentLoc:  string | null,
  ataFinal:    string | null
): string {
  if (ataFinal) return 'DEST_ARR';  // arrived

  const seg = (segmentName ?? '').toLowerCase();
  const loc = (currentLoc  ?? '').toLowerCase();

  if (seg.includes('korea â†’') || seg.includes('incheon â†’') || loc.includes('incheon')) return 'ORIGIN_DEP';
  if (seg.includes('â†’ qingdao') || seg.includes('â†’ lianyungang') || loc.includes('qingdao')) return 'SEA_TS_ARR';
  if (seg.includes('qingdao â†’') || seg.includes('lianyungang â†’')) return 'RAIL_DEP_CN';
  if (seg.includes('kashgar â†’') && seg.includes('â†’ andijan')) return 'KG_UZ_BORDER';
  if (seg.includes('kashgar â†’') && seg.includes('â†’ osh'))     return 'KG_UZ_BORDER';
  if (loc.includes('kashgar') || loc.includes('kashi'))        return 'KASHI_ARR';
  if (loc.includes('osh'))                                      return 'KG_UZ_BORDER';
  if (loc.includes('dostuk') || loc.includes('dostyk'))         return 'CN_BORDER';
  if (loc.includes('khorgos') || loc.includes('horgos'))        return 'CN_BORDER';
  return 'DEST_ARR';  // in transit, milestone unclear â†’ use total T/T
}

// â”€â”€â”€ Week ISO from a date string â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// ISO 8601: week 1 = the week containing the first Thursday of the year (Mon start).
function toWeekIso(dateStr: string | null): string {
  const d = dateStr ? new Date(dateStr) : new Date();
  if (isNaN(d.getTime())) return toWeekIso(null);
  const day      = d.getUTCDay() === 0 ? 7 : d.getUTCDay(); // 1=Mon â€¦ 7=Sun
  const thursday = new Date(d);
  thursday.setUTCDate(d.getUTCDate() + 4 - day);            // Thursday of same ISO week
  const yearStart = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 1));
  const weekNo    = Math.ceil(((thursday.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${thursday.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

// â”€â”€â”€ Stats helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

// â”€â”€â”€ Raw API type â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
interface RawContainer {
  container_no:         string;   // internal key â€” NOT stored in published columns
  customer_list:        string;   // â›” STRIP â€” never store
  origin:               string;
  destination:          string;
  current_location:     string | null;
  latitude:             number | null;
  longitude:            number | null;
  signal:               string | null;  // green | red | blue
  eta_final:            string | null;
  ata_final:            string | null;
  current_segment_name: string | null;
  open_alert_count:     number;
  transport_mode:       string | null;
  load_type:            string | null;
}

interface ApiResponse {
  containers: RawContainer[];
  total:      number;
}

// â”€â”€â”€ Main â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function main() {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('âŒ SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY í™˜ê²½ë³€ìˆ˜ ì—†ìŒ.');
    process.exit(1);
  }

  // â”€â”€ 1. Fetch live API â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const headers: Record<string, string> = { 'Accept': 'application/json' };
  if (API_TOKEN) headers['Authorization'] = `Bearer ${API_TOKEN}`;

  console.log(`ðŸŒ Fetching ${API_URL} â€¦`);
  const res = await fetch(API_URL, { headers });
  if (!res.ok) throw new Error(`API HTTP ${res.status} â€” ${await res.text()}`);

  const payload = await res.json() as ApiResponse;
  const containers = payload.containers ?? [];
  console.log(`ðŸ“¦ ${containers.length}ê±´ ìˆ˜ì‹  (API total: ${payload.total})`);

  // â”€â”€ 2. Map â†’ shipment_legs â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  let skipped = 0;
  const legRows: Record<string, unknown>[] = [];

  for (const c of containers) {
    // Skip if no destination or origin
    if (!c.destination || !c.origin) { skipped++; continue; }

    const laneId       = deriveLane(c.origin, c.destination);
    if (!laneId) {
      console.warn(`  âš ï¸  lane ë¯¸ê°ì§€: ${c.origin} â†’ ${c.destination}`);
      skipped++;
      continue;
    }

    const routePattern = deriveRoutePattern(c.current_segment_name, c.destination, c.current_location);
    const milestone    = deriveCurrentMilestone(c.current_segment_name, c.current_location, c.ata_final);

    // Delay calculation (hours)
    let delayHours: number | null = null;
    if (c.eta_final && c.ata_final) {
      // Completed: actual âˆ’ planned
      delayHours = (new Date(c.ata_final).getTime() - new Date(c.eta_final).getTime()) / 3_600_000;
    } else if (c.eta_final && !c.ata_final && c.signal === 'red') {
      // In-transit overdue: now âˆ’ ETA
      const overdueMsec = Date.now() - new Date(c.eta_final).getTime();
      if (overdueMsec > 0) delayHours = overdueMsec / 3_600_000;
    }

    // Week ISO â€” use ETA week for completed, current week for in-transit
    const weekIso = toWeekIso(c.ata_final ?? c.eta_final);

    // Anonymize container_no: SHA-256 first 12 hex chars (not reversible)
    const anonRef = `live:${createHash('sha256').update(c.container_no).digest('hex').slice(0, 12)}`;

    legRows.push({
      lane_id:       laneId,
      shipment_ref:  anonRef,
      week_iso:      weekIso,
      route_pattern: routePattern,
      destination:   c.destination,
      milestone:     milestone,
      planned_at:    c.eta_final    ? new Date(c.eta_final).toISOString()  : null,
      actual_at:     c.ata_final    ? new Date(c.ata_final).toISOString()  : null,
      delay_hours:   delayHours !== null ? Math.round(delayHours * 10) / 10 : null,
      current_loc:   c.current_location,
      signal:        c.signal,
      transport_mode: c.transport_mode,
      load_type:     c.load_type,
      data_source:   'tracing',
      // â›” customer_list NOT stored (PII stripped)
    });
  }

  console.log(`âœ… ${legRows.length}ê±´ ë§¤í•‘ / ${skipped}ê±´ ìŠ¤í‚µ`);

  // â”€â”€ 3. Fetch valid lane IDs from DB (guard against FK violation) â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const lanesRes = await fetch(`${SUPABASE_URL}/rest/v1/lanes?select=id`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  });
  if (!lanesRes.ok) {
    throw new Error(`Failed to fetch lane IDs: HTTP ${lanesRes.status}`);
  }
  const validLanes: Set<string> = new Set();
  const laneList = await lanesRes.json() as { id: string }[];
  laneList.forEach(l => validLanes.add(l.id));

  const filteredLegs = legRows.filter(leg => {
    if (!validLanes.has(leg.lane_id as string)) {
      console.warn(`  âš ï¸  lane "${leg.lane_id}" not in DB â€” skipping row`);
      return false;
    }
    return true;
  });
  console.log(`ðŸ” DB lane í•„í„°ë§ í›„: ${filteredLegs.length}ê±´ (ì œì™¸ ${legRows.length - filteredLegs.length}ê±´)`);

  // â”€â”€ Upsert shipment_legs (service-role only) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  await sbUpsert('shipment_legs', filteredLegs, 'shipment_ref,milestone');
  console.log(`ðŸ’¾ shipment_legs upsert ì™„ë£Œ (${filteredLegs.length}ê±´)`);

  // â”€â”€ 4. Aggregate â†’ delay_index_weekly â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Key = lane_id|week_iso â€” must match unique constraint (lane_id, week_iso, milestone).
  // route_pattern stored as the most-frequent value within the bucket (not part of PK).
  type Bucket = { laneId: string; weekIso: string; delays: number[]; routeCounts: Map<string, number> };
  const buckets = new Map<string, Bucket>();

  for (const leg of filteredLegs) {
    const d = leg.delay_hours as number | null;
    if (d === null) continue;
    // Only aggregate completed arrivals and confirmed overdue red-signal
    if (leg.milestone !== 'DEST_ARR' && leg.signal !== 'red') continue;

    const key = `${leg.lane_id}|${leg.week_iso}`;
    if (!buckets.has(key)) {
      buckets.set(key, {
        laneId:  leg.lane_id as string,
        weekIso: leg.week_iso as string,
        delays:  [],
        routeCounts: new Map(),
      });
    }
    const b = buckets.get(key)!;
    b.delays.push(d);
    // Track dominant route_pattern
    const rp = (leg.route_pattern as string | null) ?? '__none__';
    b.routeCounts.set(rp, (b.routeCounts.get(rp) ?? 0) + 1);
  }

  const indexRows: Record<string, unknown>[] = [];
  for (const [, b] of buckets) {
    const n   = b.delays.length;
    const med = median(b.delays);
    const p   = p90(b.delays);
    const otp = b.delays.filter(h => h <= 0).length / n;
    // Pick dominant route_pattern (most frequent, excluding '__none__' placeholder)
    let domRoute: string | null = null;
    let domCount = 0;
    for (const [rp, cnt] of b.routeCounts) {
      if (rp !== '__none__' && cnt > domCount) { domRoute = rp; domCount = cnt; }
    }
    indexRows.push({
      lane_id:        b.laneId,
      week_iso:       b.weekIso,
      milestone:      'DEST_ARR',
      route_pattern:  domRoute,
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
    console.log(`ðŸ“Š delay_index_weekly upsert ì™„ë£Œ (${indexRows.length}ê±´)`);
  }

  // â”€â”€ 5. Print snapshot â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  console.log('\nâ”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”');
  console.log(`ðŸ“Š CADI Live Snapshot â€” ${containers.length}ê±´ processed`);
  console.log('â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”');
  console.log(`${'Lane'.padEnd(22)} ${'Week'.padEnd(9)} ${'n'.padStart(3)} ${'Med(d)'.padStart(8)} ${'P90(d)'.padStart(8)} ${'OTP%'.padStart(6)}  Quality`);
  console.log('â”€'.repeat(72));

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

  // ðŸ”´ Bottleneck hotspot
  const red = filteredLegs.filter(l => l.signal === 'red');
  console.log(`\nðŸ”´ Red-signal ì»¨í…Œì´ë„ˆ: ${red.length}ê±´ (ë³‘ëª© í•«ìŠ¤íŒŸ)`);
  const hotspot = new Map<string, number>();
  for (const r of red) {
    const loc = String(r.current_loc ?? 'unknown');
    hotspot.set(loc, (hotspot.get(loc) ?? 0) + 1);
  }
  [...hotspot.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 7)
    .forEach(([loc, cnt]) => console.log(`   ${loc.padEnd(20)} ${cnt}ê±´`));

  console.log('â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”');
  console.log(`âš ï¸  ë³´ì•ˆ: customer_list ì €ìž¥ ì•ˆë¨. MTL Link read í† í° ì ìš© ê¶Œê³ .`);
}

main().catch(err => { console.error('âŒ tracing_live ì‹¤íŒ¨:', err); process.exit(1); });
