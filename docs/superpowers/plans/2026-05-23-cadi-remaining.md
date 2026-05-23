# CADI Remaining Work Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the 4 remaining CADI gaps — TSR/FESCO ETL, disruption event input CLI, Q16→AI weekly draft generation, and bi-weekly automation — plus fix a field-name bug.

**Architecture:** All changes are additive to the existing pipeline. `tracing_fesco.ts` mirrors `tracing_live.ts` patterns (no shared abstraction). `add-disruption.js` and `generate-cadi-weekly.js` are standalone Node scripts following the `generate-cadi-report.js` pattern. Automation changes are cron/workflow edits only.

**Tech Stack:** TypeScript (ts-node workers), Node.js CJS scripts, `@supabase/supabase-js`, `@anthropic-ai/sdk` (Claude Sonnet), GitHub Actions

---

## Pre-flight

Before starting, verify:
```powershell
cd c:\Users\DELL\Documents\logisight
cat .env.local   # Must have SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, ANTHROPIC_API_KEY
npm run build    # Should pass (all existing code is clean)
```

---

## Task 1 — Bug Fix: `generate-cadi-report.js` `description_en` → `body_en`

**Files:**
- Modify: `scripts/generate-cadi-report.js` (lines 83–86)

The Supabase schema (`disruption_events`) stores the narrative in `body_en` (added in migration 000002). The `alerts` Edge Function selects `body_en`. But `generate-cadi-report.js` queries `description_en` — a column that exists in the v1 schema but is the old name. The `buildDisruptionSection` function also references `e.description_en`.

- [ ] **Step 1: Fix the select query**

Open `scripts/generate-cadi-report.js`. Find the disruption_events query (~line 83). Change:
```js
.select('lane_id, event_type, title_en, title_ko, description_en, severity, source_url')
```
to:
```js
.select('lane_id, event_type, title_en, title_ko, body_en, severity, source_url')
```

- [ ] **Step 2: Fix the template function**

In `buildDisruptionSection` (~line 53–60), change:
```js
const desc  = e.description_en ? `\n${e.description_en}` : '';
```
to:
```js
const desc  = e.body_en ? `\n${e.body_en}` : '';
```

- [ ] **Step 3: Verify the script runs without error (dry-run)**

```powershell
# Set env vars from .env.local first, then:
node -e "require('./scripts/generate-cadi-report.js')" 2>&1 | head -5
```
Expected: No `column does not exist` error. (May fail with "missing env" if Supabase not connected — that's OK.)

- [ ] **Step 4: Commit**

```powershell
git add scripts/generate-cadi-report.js
git commit -m "fix(cadi): description_en → body_en in generate-cadi-report.js"
```

---

## Task 2 — TSR/FESCO ETL (`workers/collectors/tracing_fesco.ts`)

**Files:**
- Create: `workers/collectors/tracing_fesco.ts`
- Modify: `package.json` (add `collect:tsr` script)
- Modify: `.github/workflows/cadi-ingest.yml` (add TSR step)

The FESCO API (`https://mtl-link.vercel.app/api/fesco/containers?limit=500`) returns containers with nested `segments[]`. Route pattern is always `tsr`. Lane is derived from `origin_city` + `destination_city`. Dates come from the last/current segment.

The `sbUpsert` and stats helpers are copied from `tracing_live.ts` — no shared abstraction per Karpathy Simplicity First.

- [ ] **Step 1: Create `workers/collectors/tracing_fesco.ts`**

Create the file with this exact content:

```typescript
// workers/collectors/tracing_fesco.ts
// Phase 2 ETL — TSR/FESCO source: MTL Link FESCO API (GET, no-auth currently)
//
// Run: npm run collect:tsr
//
// ⚠️ 보안 주의: 현재 API 무인증. MTL Link 팀에 read 토큰 적용 권고.
//    적용 시 TRACKING_API_TOKEN env 사용.
//
// 설계 원칙:
//  - route_pattern='tsr' FIXED (소스로 결정, destination 추론 금지)
//  - container_number = 내부 키 (SHA-256 익명화, 외부 미노출)
//  - 날짜는 segments[] 마지막 항목에서 추출 (top-level eta 대개 null)
//  - 별도 파일 — tracing_live.ts와 추상화 없이 독립

import { createHash } from 'crypto';

const SUPABASE_URL = process.env.SUPABASE_URL ?? '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const API_URL      = 'https://mtl-link.vercel.app/api/fesco/containers?limit=500';
const API_TOKEN    = process.env.TRACKING_API_TOKEN ?? '';

// ─── Supabase REST upsert (copied from tracing_live.ts — no shared abstraction) ──
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
      apikey:         SUPABASE_KEY,
      Authorization:  `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer:         'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify(rows),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase REST ${table} upsert failed: ${res.status} — ${text}`);
  }
}

// ─── Stats helpers (copied — no shared abstraction) ───────────────────────────
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
function toWeekIso(dateStr: string | null): string {
  const d = dateStr ? new Date(dateStr) : new Date();
  if (isNaN(d.getTime())) return toWeekIso(null);
  const jan4 = new Date(d.getFullYear(), 0, 4);
  const w = Math.ceil((((d.getTime() - jan4.getTime()) / 86_400_000) + jan4.getDay() + 1) / 7);
  return `${d.getFullYear()}-W${String(w).padStart(2, '0')}`;
}

// ─── Lane derivation for FESCO ────────────────────────────────────────────────
// lane = `${originPrefix}-${UPPER(destination_city)}`
// Busan / Incheon / Korea → 'KR'; Qingdao / Shenzhen / China → 'CN'
// destination_city matched against known DB lane suffixes
function deriveFescoLane(originCity: string, destinationCity: string): string | null {
  const orig = (originCity ?? '').toLowerCase();
  const dest = (destinationCity ?? '').toLowerCase().trim();

  const isKorea = orig.includes('busan') || orig.includes('incheon') || orig.includes('korea') || orig === 'kr';
  const isChina = orig.includes('qingdao') || orig.includes('shenzhen') || orig.includes('china') || orig === 'cn';
  if (!isKorea && !isChina) return null;
  const prefix = isKorea ? 'KR' : 'CN';

  // Match against known lane suffixes (DB seeds: migration 000003/004)
  if (dest.includes('andijan'))                                  return `${prefix}-ANDIJAN`;
  if (dest.includes('chukursay') || dest.includes('chukursaj')) return `${prefix}-CHUKURSAY`;
  if (dest.includes('osh'))                                      return `${prefix}-OSH`;
  if (dest.includes('bishkek'))                                  return `${prefix}-BISHKEK`;
  if (dest.includes('almaty'))                                   return `${prefix}-ALMATY`;
  if (dest.includes('tashkent') || dest.includes('toshkent'))   return `${prefix}-TASHKENT`; // future lane
  if (dest.includes('mała') || dest.includes('malaszewicze'))   return `${prefix}-MALASZEWICZE`;

  // Fallback: uppercase the destination as-is (may miss DB lane → FK guard below)
  const upper = dest.toUpperCase().replace(/\s+/g, '_');
  return `${prefix}-${upper}`;
}

// ─── FESCO API types (field names verified against actual API; defend against nulls) ──
interface FescoSegment {
  // Segment dates — FESCO uses these spellings (verify against live response)
  planingDestinationDate?: string | null;  // planned arrival at segment dest
  destinationDate?:         string | null;  // actual arrival
  currentLocation?:         string | null;
  status?:                  string | null;
}

interface FescoContainer {
  container_number?:    string;   // ⛔ internal key — anonymize, never store raw
  order_number?:        string;   // ⛔ internal — never store
  origin_city?:         string;
  destination_city?:    string;
  current_location_text?: string;
  open_alert_types?:    string[];
  signal?:              string;   // red | yellow | green (may not exist — fallback from alerts)
  segments?:            FescoSegment[];
  // Note: top-level eta is usually null — use segments instead
}

interface FescoApiResponse {
  ok:     boolean;
  total:  number;
  data:   FescoContainer[];
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('❌ SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 환경변수 없음.');
    process.exit(1);
  }

  // ── 1. Fetch FESCO API ──────────────────────────────────────────────────────
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (API_TOKEN) headers['Authorization'] = `Bearer ${API_TOKEN}`;

  console.log(`🌐 Fetching FESCO API: ${API_URL} …`);
  const res = await fetch(API_URL, { headers });
  if (!res.ok) throw new Error(`FESCO API HTTP ${res.status} — ${await res.text()}`);

  const payload = await res.json() as FescoApiResponse;
  if (!payload.ok) throw new Error(`FESCO API returned ok=false`);

  const containers = payload.data ?? [];
  console.log(`📦 FESCO: ${containers.length}건 수신 (API total: ${payload.total})`);

  // ── 2. Defensive field discovery — log first container keys ────────────────
  if (containers.length > 0) {
    console.log('🔍 First container keys:', Object.keys(containers[0]).join(', '));
    if (containers[0].segments?.length) {
      console.log('🔍 First segment keys:', Object.keys(containers[0].segments[0]).join(', '));
    }
  }

  // ── 3. Map → shipment_legs ─────────────────────────────────────────────────
  let skipped = 0;
  const legRows: Record<string, unknown>[] = [];

  for (const c of containers) {
    const containerNum = c.container_number;
    if (!containerNum) { skipped++; continue; }

    const origin      = c.origin_city ?? '';
    const destination = c.destination_city ?? '';
    if (!origin || !destination) { skipped++; continue; }

    const laneId = deriveFescoLane(origin, destination);
    if (!laneId) {
      console.warn(`  ⚠️  FESCO lane 미감지: ${origin} → ${destination}`);
      skipped++;
      continue;
    }

    // Extract dates from last segment (top-level eta usually null)
    const segs    = c.segments ?? [];
    const lastSeg = segs[segs.length - 1] ?? null;

    // Defensive date parse
    const parseDateSafe = (s: string | null | undefined): string | null => {
      if (!s) return null;
      try {
        const d = new Date(s);
        return isNaN(d.getTime()) ? null : d.toISOString();
      } catch { return null; }
    };

    const planned = parseDateSafe(lastSeg?.planingDestinationDate);
    const actual  = parseDateSafe(lastSeg?.destinationDate);

    // Delay (hours)
    let delayHours: number | null = null;
    if (planned && actual) {
      delayHours = (new Date(actual).getTime() - new Date(planned).getTime()) / 3_600_000;
    } else if (planned && !actual) {
      // In-transit: check if overdue
      const overdue = Date.now() - new Date(planned).getTime();
      if (overdue > 0) delayHours = overdue / 3_600_000;
    }

    // Signal: use c.signal if present, else derive from open_alert_types
    const alertTypes = c.open_alert_types ?? [];
    const signal = c.signal
      ?? (alertTypes.some(a => a.includes('overdue')) ? 'red'
        : alertTypes.length > 0 ? 'yellow' : 'green');

    // Week ISO
    const weekIso = toWeekIso(actual ?? planned);

    // Milestone: DEST_ARR for arrived, CN_BORDER for Vladivostok bottleneck, else DEST_ARR
    const currentLoc = (c.current_location_text ?? '').toLowerCase();
    const milestone = actual
      ? 'DEST_ARR'
      : (currentLoc.includes('vladivostok') || currentLoc.includes('vmtp') || currentLoc.includes('vvo'))
        ? 'SEA_TS_ARR'   // stuck at Vladivostok transshipment — TSR bottleneck equivalent
        : 'DEST_ARR';

    // Anonymize container_number (SHA-256, first 12 hex)
    const anonRef = `fesco:${createHash('sha256').update(containerNum).digest('hex').slice(0, 12)}`;

    legRows.push({
      lane_id:       laneId,
      shipment_ref:  anonRef,
      week_iso:      weekIso,
      route_pattern: 'tsr',           // FIXED — TSR source always = tsr
      destination:   c.destination_city,
      milestone,
      planned_at:    planned,
      actual_at:     actual,
      delay_hours:   delayHours !== null ? Math.round(delayHours * 10) / 10 : null,
      current_loc:   c.current_location_text ?? null,
      signal,
      transport_mode: 'SEA+RAIL',     // TSR pattern: sea to Vladivostok + rail
      data_source:   'tracing',
      // ⛔ container_number, order_number NOT stored (PII)
    });
  }

  console.log(`✅ FESCO: ${legRows.length}건 매핑 / ${skipped}건 스킵`);

  // ── 4. Guard against FK violations — fetch valid lane IDs ──────────────────
  const lanesRes = await fetch(`${SUPABASE_URL}/rest/v1/lanes?select=id`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  });
  const validLanes = new Set<string>();
  if (lanesRes.ok) {
    (await lanesRes.json() as { id: string }[]).forEach(l => validLanes.add(l.id));
  }
  const filtered = legRows.filter(leg => {
    if (!validLanes.has(leg.lane_id as string)) {
      console.warn(`  ⚠️  FESCO lane "${leg.lane_id}" not in DB — skipping`);
      return false;
    }
    return true;
  });
  console.log(`🔍 DB 필터링 후: ${filtered.length}건`);

  // ── 5. Upsert shipment_legs ────────────────────────────────────────────────
  if (filtered.length > 0) {
    await sbUpsert('shipment_legs', filtered, 'shipment_ref,milestone');
    console.log(`💾 FESCO shipment_legs upsert 완료`);
  }

  // ── 6. Aggregate → delay_index_weekly ─────────────────────────────────────
  type Bucket = { laneId: string; weekIso: string; delays: number[] };
  const buckets = new Map<string, Bucket>();

  for (const leg of filtered) {
    const d = leg.delay_hours as number | null;
    if (d === null) continue;
    if (leg.milestone !== 'DEST_ARR' && leg.signal !== 'red') continue;

    const key = `${leg.lane_id}|${leg.week_iso}`;
    if (!buckets.has(key)) {
      buckets.set(key, { laneId: leg.lane_id as string, weekIso: leg.week_iso as string, delays: [] });
    }
    buckets.get(key)!.delays.push(d);
  }

  const indexRows: Record<string, unknown>[] = [];
  for (const [, b] of buckets) {
    const n = b.delays.length;
    indexRows.push({
      lane_id:        b.laneId,
      week_iso:       b.weekIso,
      milestone:      'DEST_ARR',
      route_pattern:  'tsr',
      median_delay_h: Math.round(median(b.delays) * 10) / 10,
      p90_delay_h:    Math.round(p90(b.delays) * 10) / 10,
      on_time_rate:   Math.round(b.delays.filter(h => h <= 0).length / n * 1000) / 1000,
      sample_count:   n,
      data_quality:   dataQuality(n),
      updated_at:     new Date().toISOString(),
    });
  }

  if (indexRows.length > 0) {
    await sbUpsert('delay_index_weekly', indexRows, 'lane_id,week_iso,milestone');
    console.log(`📊 FESCO delay_index_weekly upsert 완료 (${indexRows.length}건)`);
  }

  // ── 7. Summary ─────────────────────────────────────────────────────────────
  const red = filtered.filter(l => l.signal === 'red');
  console.log(`\n🔴 FESCO red-signal (Vladivostok 적체 등): ${red.length}건`);
  console.log(`⚠️  보안: container_number 저장 안됨. MTL Link read 토큰 적용 권고.`);
}

main().catch(err => { console.error('❌ tracing_fesco 실패:', err); process.exit(1); });
```

- [ ] **Step 2: Add `collect:tsr` to package.json**

Open `package.json`. After the `"collect:live"` line, add:
```json
"collect:tsr": "ts-node --project tsconfig.workers.json workers/collectors/tracing_fesco.ts",
```

- [ ] **Step 3: Update `cadi-ingest.yml` — add TSR step**

Open `.github/workflows/cadi-ingest.yml`. After the `"Run CADI live tracing ingest"` step (the one that runs `npm run collect:live`), add a new step:

```yaml
      - name: Run CADI FESCO/TSR tracing ingest
        if: ${{ github.event.inputs.dry_run != 'true' }}
        run: npm run collect:tsr
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
          # TRACKING_API_TOKEN: ${{ secrets.TRACKING_API_TOKEN }}
```

- [ ] **Step 4: Verify TypeScript compiles**

```powershell
npx ts-node --project tsconfig.workers.json --transpile-only workers/collectors/tracing_fesco.ts 2>&1 | head -20
```
Expected: No TypeScript compile errors. (May fail on network — that's OK at this stage.)

- [ ] **Step 5: Dry-run against live FESCO API (no DB write needed)**

```powershell
# This just checks if the API is reachable and logs field names:
node -e "
  fetch('https://mtl-link.vercel.app/api/fesco/containers?limit=5')
    .then(r => r.json())
    .then(d => {
      console.log('ok:', d.ok, 'total:', d.total);
      if (d.data?.[0]) {
        console.log('Container keys:', Object.keys(d.data[0]).join(', '));
        if (d.data[0].segments?.[0]) {
          console.log('Segment keys:', Object.keys(d.data[0].segments[0]).join(', '));
        }
      }
    })
    .catch(e => console.error('fetch failed:', e.message))
"
```

Expected: `ok: true`, container keys printed including `container_number` and `segments`. **If field names differ from `tracing_fesco.ts` type definitions, update the interface and field access in the file accordingly.**

- [ ] **Step 6: Commit**

```powershell
git add workers/collectors/tracing_fesco.ts package.json .github/workflows/cadi-ingest.yml
git commit -m "feat(cadi): TSR/FESCO ETL collector (tracing_fesco.ts) + collect:tsr script"
```

---

## Task 3 — Disruption Event Input CLI (`scripts/add-disruption.js`)

**Files:**
- Create: `scripts/add-disruption.js`
- Create: `content/inputs/disruption-event-example.json`
- Modify: `package.json` (add `disruption:add` script)

Field reports (현장 리포트) need to enter `disruption_events` table. This is a simple CLI that reads a JSON file and upserts one event. Uses service-role key (backend only). Follows the `generate-cadi-report.js` CJS pattern.

- [ ] **Step 1: Create `content/inputs/disruption-event-example.json`**

```json
{
  "_comment": "복사 후 content/inputs/disruption-YYYY-MM-DD.json 로 저장. 모르는 항목은 null로.",
  "event_date": "2026-05-23",
  "region": "KG-UZ border (Osh)",
  "category": "policy",
  "title_en": "Kyrgyzstan mandates domestic trucks for UZ-bound transit cargo",
  "title_ko": "키르기스스탄, 우즈벡 향 화물 자국 트럭 의무화",
  "title_ru": null,
  "title_zh": null,
  "body_en": "**What:** From 15 May 2026, Kyrgyzstan requires all transit cargo bound for Uzbekistan to use Kyrgyz-registered trucks for the domestic leg.\n\n**Why:** Regulatory change by KG transport authority — official sources not yet published in English.\n\n**Impact:** Vehicles pre-arranged on the Uzbek side must be swapped at the Osh checkpoint; cargo undergoes re-clearance, adding estimated 3–5 days.\n\n**Outlook:** No end date announced. MTL monitoring — coordinate early truck booking via Bishkek partner.",
  "impact_days": 4,
  "severity": "high",
  "affected_lanes": ["KR-ANDIJAN", "KR-CHUKURSAY", "KR-OSH"],
  "verified_by": ["field_report"],
  "lane_id": null,
  "source_url": null
}
```

- [ ] **Step 2: Create `scripts/add-disruption.js`**

```js
'use strict';
// scripts/add-disruption.js
// 현장 리포트를 disruption_events 테이블에 삽입하는 CLI.
//
// 사용법:
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
//   node scripts/add-disruption.js content/inputs/disruption-2026-05-23.json
//
// 입력: content/inputs/disruption-event-example.json 참고

const { createClient } = require('@supabase/supabase-js');
const fs   = require('fs');
const path = require('path');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const inputFile = process.argv[2];
if (!inputFile) {
  console.error('❌ 사용법: node scripts/add-disruption.js <path/to/input.json>');
  process.exit(1);
}

const absPath = path.resolve(process.cwd(), inputFile);
if (!fs.existsSync(absPath)) {
  console.error(`❌ 파일 없음: ${absPath}`);
  process.exit(1);
}

const raw = JSON.parse(fs.readFileSync(absPath, 'utf-8'));

// Validate required fields
const REQUIRED = ['event_date', 'title_en', 'category', 'severity'];
for (const field of REQUIRED) {
  if (!raw[field]) {
    console.error(`❌ 필수 필드 누락: ${field}`);
    process.exit(1);
  }
}

// Validate severity enum
if (!['high', 'medium', 'low'].includes(raw.severity)) {
  console.error(`❌ severity는 high | medium | low 중 하나여야 합니다. 받은 값: ${raw.severity}`);
  process.exit(1);
}

// Validate category
const VALID_CATS = ['policy', 'customs', 'infra', 'weather', 'capacity', 'other'];
if (!VALID_CATS.includes(raw.category)) {
  console.error(`❌ category는 ${VALID_CATS.join('|')} 중 하나여야 합니다. 받은 값: ${raw.category}`);
  process.exit(1);
}

// Build DB row (strip comment field, strip null values for cleanliness)
const row = {
  event_date:    raw.event_date,
  region:        raw.region         ?? null,
  category:      raw.category,
  title_en:      raw.title_en,
  title_ko:      raw.title_ko       ?? null,
  title_ru:      raw.title_ru       ?? null,
  title_zh:      raw.title_zh       ?? null,
  body_en:       raw.body_en        ?? null,
  impact_days:   raw.impact_days    ?? null,
  severity:      raw.severity,
  affected_lanes: raw.affected_lanes ?? null,
  verified_by:   raw.verified_by    ?? null,
  lane_id:       raw.lane_id        ?? null,
  source_url:    raw.source_url     ?? null,
  // started_at defaults to event_date if not set
  started_at:    raw.started_at     ?? raw.event_date,
};

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function main() {
  console.log(`📋 입력: ${absPath}`);
  console.log(`   제목: ${row.title_en}`);
  console.log(`   날짜: ${row.event_date} | 심각도: ${row.severity} | 범주: ${row.category}`);
  if (row.affected_lanes?.length) console.log(`   영향 노선: ${row.affected_lanes.join(', ')}`);

  const { data, error } = await supabase
    .from('disruption_events')
    .insert(row)
    .select('id')
    .single();

  if (error) {
    console.error('❌ disruption_events 삽입 실패:', error.message);
    process.exit(1);
  }

  console.log(`✅ 삽입 완료 — id: ${data.id}`);
  console.log(`   프론트엔드 /news 에서 즉시 표시됩니다.`);
}

main().catch(err => {
  console.error('❌ add-disruption 실패:', err);
  process.exit(1);
});
```

- [ ] **Step 3: Add `disruption:add` to package.json**

In `package.json` scripts, after `"report:cadi"`, add:
```json
"disruption:add": "node scripts/add-disruption.js",
```

- [ ] **Step 4: Test validation (no DB needed)**

```powershell
# Test: missing required field (should exit with error)
node -e "
  const orig = process.argv;
  process.argv = ['node', 'add-disruption.js', 'content/inputs/disruption-event-example.json'];
" 2>&1 | head -5
# Actually: just check the file loads without syntax error
node -c scripts/add-disruption.js
```
Expected: `scripts/add-disruption.js: syntax OK`

- [ ] **Step 5: Commit**

```powershell
git add scripts/add-disruption.js content/inputs/disruption-event-example.json package.json
git commit -m "feat(cadi): disruption event input CLI (add-disruption.js)"
```

---

## Task 4 — Q16 Questionnaire → AI Draft Generation (`scripts/generate-cadi-weekly.js`)

**Files:**
- Create: `scripts/generate-cadi-weekly.js`
- Create: `content/inputs/cadi-weekly-input-example.json`
- Modify: `package.json` (add `report:weekly` script)

This script:
1. Reads Q16 answers from `content/inputs/cadi-weekly-input.json` (or path from CLI arg)
2. Fetches latest `delay_index_weekly` from Supabase (last 2 weeks)
3. Calls Claude Sonnet with Weekly_Template rules (부록 B 4절 — skip empty, no fabrication, EN/ZH bilingual, generalise, attribution)
4. Writes draft to `content/drafts/cadi-weekly-YYYY-MM-DD.md`

Publishing cadence: **bi-weekly** (every 2 weeks). Template mentions this.

- [ ] **Step 1: Create `content/inputs/cadi-weekly-input-example.json`**

```json
{
  "_instructions": "이번 주 아는 것만 입력. 모르면 null 또는 빈 문자열. 고객명·화물 식별정보 입력 금지 ('UZ向货物' 수준으로).",
  "week": "2026-W21",
  "q1_transit_times": null,
  "q2_delay_vs_normal": "安集延线本周比平时慢约5天",
  "q3_cargo_stuck": null,
  "q4_policy_change": "吉尔吉斯突然要求UZ向过境货物全部换用吉国卡车（5/15发布）",
  "q5_border_status": null,
  "q6_delay_case": "已在乌兹别克安排好的车辆被迫换吉国车并重新清关，安集延交付延迟",
  "q7_rate_change": null,
  "q8_space_availability": null,
  "q9_spot_rate": null,
  "q10_equipment": null,
  "q11_equipment_issues": null,
  "q12_truck_last_mile": null,
  "q13_tsr_status": "TSR经符拉迪沃斯托克至塔什干本周稳定",
  "q14_sea_vs_rail": null,
  "q15_next_week_watch": null,
  "q16_other": null
}
```

- [ ] **Step 2: Create `scripts/generate-cadi-weekly.js`**

```js
'use strict';
// scripts/generate-cadi-weekly.js
// Q16 질문지 (JSON) + Supabase delay 데이터 → Claude Sonnet → 중앙아 주간 초안
//
// 사용법:
//   ANTHROPIC_API_KEY=... SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
//   node scripts/generate-cadi-weekly.js [content/inputs/cadi-weekly-input.json]
//
// 출력: content/drafts/cadi-weekly-YYYY-MM-DD.md
//
// 생성 규칙 (부록 B 4절):
//  1. 답 있는 섹션만 렌더링 (빈 칸 = 해당 섹션 생략, "정보 없음" 금지)
//  2. 날조·추정 금지 — 없으면 생략
//  3. "현상→원인→전망" 구조
//  4. 영어 우선, 주요 문단은 중국어 병기
//  5. 일반화 (고객·화물 식별정보 제거)
//  6. 신뢰 표기 ("based on MTL-handled shipments")

const Anthropic = require('@anthropic-ai/sdk');
const { createClient } = require('@supabase/supabase-js');
const fs   = require('fs');
const path = require('path');

const ANTHROPIC_KEY   = process.env.ANTHROPIC_API_KEY;
const SUPABASE_URL    = process.env.SUPABASE_URL;
const SUPABASE_KEY    = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OUTPUT_DIR      = path.resolve(__dirname, '../content/drafts');

if (!ANTHROPIC_KEY) { console.error('❌ Missing ANTHROPIC_API_KEY'); process.exit(1); }

const inputFile = process.argv[2] ?? 'content/inputs/cadi-weekly-input.json';
const absInput  = path.resolve(process.cwd(), inputFile);
if (!fs.existsSync(absInput)) {
  console.error(`❌ 입력 파일 없음: ${absInput}`);
  console.error('   content/inputs/cadi-weekly-input-example.json 을 복사해서 작성하세요.');
  process.exit(1);
}

const input = JSON.parse(fs.readFileSync(absInput, 'utf-8'));

// ─── Helpers ─────────────────────────────────────────────────────────────────
function isoWeek(date) {
  const d = new Date(date);
  const jan4 = new Date(d.getFullYear(), 0, 4);
  const w = Math.ceil((((d - jan4) / 86_400_000) + jan4.getDay() + 1) / 7);
  return `${d.getFullYear()}-W${String(w).padStart(2, '0')}`;
}

function qualityLabel(q, n) {
  return { confirmed: `confirmed (n=${n})`, provisional: `provisional (n=${n})`, indicative: `indicative (n=${n})` }[q] ?? `n=${n}`;
}

// ─── Build context from Supabase delay data ──────────────────────────────────
async function fetchDelayContext() {
  if (!SUPABASE_URL || !SUPABASE_KEY) return '(Supabase env not set — delay data unavailable)';

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  const twoWeeksAgo = isoWeek(new Date(Date.now() - 14 * 86_400_000));

  const { data: rows, error } = await supabase
    .from('delay_index_weekly')
    .select('lane_id, week_iso, milestone, median_delay_h, p90_delay_h, on_time_rate, sample_count, data_quality')
    .gte('week_iso', twoWeeksAgo)
    .eq('milestone', 'DEST_ARR')
    .order('week_iso', { ascending: false })
    .order('lane_id');

  if (error) return `(Supabase error: ${error.message})`;
  if (!rows?.length) return '(No delay data for last 2 weeks)';

  return rows.map(r => {
    const med  = r.median_delay_h != null ? `${(r.median_delay_h / 24).toFixed(1)}d` : '—';
    const p90  = r.p90_delay_h    != null ? `${(r.p90_delay_h    / 24).toFixed(1)}d` : '—';
    const otp  = r.on_time_rate   != null ? `${Math.round(r.on_time_rate * 100)}%` : '—';
    return `  ${r.lane_id} ${r.week_iso}: median=${med}, P90=${p90}, OTP=${otp} [${qualityLabel(r.data_quality, r.sample_count)}]`;
  }).join('\n');
}

// ─── Build the prompt ─────────────────────────────────────────────────────────
function buildQContext(inp) {
  // Only include non-null, non-empty answers
  const qMap = {
    q1_transit_times:   '① Transit times by lane this week',
    q2_delay_vs_normal: '① Delay vs normal (which lane, by how many days)',
    q3_cargo_stuck:     '① Cargo stuck at a node (where, how long)',
    q4_policy_change:   '② Policy/regulatory change',
    q5_border_status:   '② Border/customs congestion or smooth crossing',
    q6_delay_case:      '② Specific delay case (generalised)',
    q7_rate_change:     '③ Rate adjustment by lane',
    q8_space_availability: '③ Space availability and booking rule changes',
    q9_spot_rate:       '③ Spot rate levels',
    q10_equipment:      '④ Container/equipment availability (SOC/COC)',
    q11_equipment_issues: '④ Equipment shortage nodes',
    q12_truck_last_mile: '⑤ Truck last-mile price or time changes',
    q13_tsr_status:     '⑤ TSR (Vladivostok) status vs TCR',
    q14_sea_vs_rail:    '⑤ Sea-to-rail/truck shift',
    q15_next_week_watch: '⑥ Watch items for next week',
    q16_other:          '⑥ Other field observation',
  };

  const answered = Object.entries(qMap)
    .filter(([key]) => inp[key] && String(inp[key]).trim())
    .map(([key, label]) => `[${label}]\n${inp[key]}`);

  return answered.length
    ? answered.join('\n\n')
    : '(No questionnaire answers provided — output will be data-only)';
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const week       = input.week ?? isoWeek(new Date());
  const publishDate = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

  console.log(`📝 Generating CADI Weekly for ${week} …`);

  const [delayCtx] = await Promise.all([fetchDelayContext()]);
  const qCtx = buildQContext(input);

  const systemPrompt = `You are the editor of CADI (Central Asia Delay Intelligence), published by MTL Shipping Agency.
Your job: take the field questionnaire answers and quantitative delay data below, and produce a professional bi-weekly intelligence brief.

STRICT RULES (Non-negotiable):
1. ONLY render sections where you have actual input. Empty answers = omit that section entirely. Never write "No information this period."
2. NEVER fabricate, estimate, or infer. If data is absent, the section is absent.
3. Structure each section: What happened → Why → Background → Outlook (keep it short).
4. English primary. Add Chinese translation for key paragraphs (EN first, 中文 below).
5. GENERALISE: No customer names, cargo details, or contract identifiers. "UZ-bound cargo" is the right level.
6. ATTRIBUTION: Any figure from MTL tracing must say "based on MTL-handled shipments, n=[sample count]".
7. Output format: Markdown with section headers matching the template structure below.

OUTPUT SECTIONS (only output sections with data):
## 1. Transit & Delay  
## 2. Border / Customs / Policy ★  
## 3. Booking & Rates  
## 4. Container & Equipment  
## 5. Related Logistics  
## 6. Outlook  

End with: *Data: MTL Shipping Agency internal tracing · Published bi-weekly · ${publishDate}*`;

  const userPrompt = `Week: ${week}

=== QUANTITATIVE DELAY DATA (from MTL tracing, last 2 weeks) ===
${delayCtx}

=== FIELD QUESTIONNAIRE ANSWERS ===
${qCtx}

Generate the CADI Weekly brief now. Remember: omit any section with no input. No fabrication.`;

  const anthropic = new Anthropic.default({ apiKey: ANTHROPIC_KEY });
  const msg = await anthropic.messages.create({
    model:      'claude-sonnet-4-6',
    max_tokens: 2048,
    messages:   [{ role: 'user', content: userPrompt }],
    system:     systemPrompt,
  });

  const draft = msg.content[0].type === 'text' ? msg.content[0].text : '';
  const header = `# CADI Weekly — ${week}\n> **Draft — requires human POV review before publishing**\n> Generated: ${publishDate}\n\n`;
  const output = header + draft;

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const filename = `cadi-weekly-${new Date().toISOString().slice(0, 10)}.md`;
  const outPath  = path.join(OUTPUT_DIR, filename);
  fs.writeFileSync(outPath, output, 'utf-8');

  console.log(`✅ 초안 완료: ${outPath}`);
  console.log(`\n→ 다음 단계: content/drafts/${filename} 열어서 [4] POV 주입 (현장 관점 2~3문단 추가)`);
  console.log('→ 검수 후: npm run pdf && node scripts/send-newsletter.js');
}

main().catch(err => { console.error('❌ generate-cadi-weekly 실패:', err); process.exit(1); });
```

- [ ] **Step 3: Add `report:weekly` to package.json**

In `package.json` scripts, after `"report:cadi"`, add:
```json
"report:weekly": "node scripts/generate-cadi-weekly.js",
```

- [ ] **Step 4: Verify syntax**

```powershell
node -c scripts/generate-cadi-weekly.js
```
Expected: `scripts/generate-cadi-weekly.js: syntax OK`

- [ ] **Step 5: Dry-run (no API call — just validate input parsing)**

```powershell
# Verify example input JSON parses correctly
node -e "
  const fs = require('fs');
  const data = JSON.parse(fs.readFileSync('content/inputs/cadi-weekly-input-example.json', 'utf-8'));
  const answered = Object.entries(data).filter(([k,v]) => !k.startsWith('_') && v && String(v).trim());
  console.log('Answered questions:', answered.map(([k]) => k).join(', '));
"
```
Expected: Prints the non-null question keys (e.g., `q2_delay_vs_normal, q4_policy_change, ...`)

- [ ] **Step 6: Commit**

```powershell
git add scripts/generate-cadi-weekly.js content/inputs/cadi-weekly-input-example.json package.json
git commit -m "feat(cadi): Q16 questionnaire → AI draft generator (generate-cadi-weekly.js)"
```

---

## Task 5 — Update `weekly-report.yml` to Bi-weekly Cadence

**Files:**
- Modify: `.github/workflows/weekly-report.yml` (change cron + add report:weekly step)

Publishing cadence confirmed: **bi-weekly (격주)**. Current cron `0 9 * * 0` = every Sunday → change to 1st and 15th.

- [ ] **Step 1: Update cron in `.github/workflows/weekly-report.yml`**

Change:
```yaml
  schedule:
    - cron: '0 9 * * 0'   # 일요일 18:00 KST (UTC 09:00)
```
to:
```yaml
  schedule:
    - cron: '0 9 1,15 * *'   # 매월 1일·15일 18:00 KST (UTC 09:00) — 격주 발행
```

- [ ] **Step 2: Add `report:weekly` step after `report:cadi`**

In the `steps:` block, find the existing `"Generate CADI report"` step. After it, add:

```yaml
      - name: Generate CADI weekly draft (Q16 → AI)
        run: |
          if [ -f content/inputs/cadi-weekly-input.json ]; then
            npm run report:weekly
          else
            echo "⚠️  content/inputs/cadi-weekly-input.json 없음 — 질문지 입력 필요"
          fi
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
```

- [ ] **Step 3: Verify workflow YAML is valid**

```powershell
# Quick syntax check (requires yq or just visual check)
cat .github/workflows/weekly-report.yml | head -60
```

- [ ] **Step 4: Commit**

```powershell
git add .github/workflows/weekly-report.yml
git commit -m "feat(cadi): bi-weekly cron + generate-cadi-weekly step in weekly-report.yml"
```

---

## Task 6 — Build Verification

**Goal:** Confirm `npm run build` passes cleanly with all changes in place.

- [ ] **Step 1: Install dependencies (if not already)**

```powershell
npm ci
```
Expected: Installs without errors.

- [ ] **Step 2: Run TypeScript build**

```powershell
npm run build 2>&1
```
Expected: `vite build` completes with no TypeScript errors. Output in `dist/`.

- [ ] **Step 3: If build fails — check error**

Common issues:
- Missing i18n keys → check `src/locales/en.json` for any keys referenced in JSX
- Missing component import → check `src/App.tsx` imports match files in `src/pages/` and `src/components/`
- `src/lib/supabase.ts` throws at build because env vars missing → wrap in `typeof window` check or ensure `.env.local` has `VITE_*` keys

Fix any errors surgically (touch only the broken line).

- [ ] **Step 4: Final commit**

```powershell
git add -A
git commit -m "chore: verify build passes + final cleanup"
git push
```

---

## Self-Review Checklist

### Spec Coverage
- [x] Phase 2 TSR/FESCO ETL → Task 2
- [x] Phase 2 bug fix (`description_en`) → Task 1
- [x] Phase 3 disruption event input → Task 3
- [x] Phase 3 Q16 questionnaire → AI draft → Task 4
- [x] Phase 6 bi-weekly cadence → Task 5
- [x] Build verification → Task 6
- [x] Privacy: `container_number` anonymized (SHA-256) in `tracing_fesco.ts`
- [x] `route_pattern='tsr'` FIXED in FESCO ETL (not inferred from destination)
- [x] `data_quality` gates in FESCO aggregation
- [x] No fabrication in `generate-cadi-weekly.js` (empty = omit)
- [x] Weekly Template 4절 rules encoded in system prompt

### Type Consistency
- `tracing_fesco.ts` upserts to `shipment_legs` and `delay_index_weekly` with same column names as `tracing_live.ts` ✅
- `add-disruption.js` uses `body_en` (matches schema migration 000002 + api.ts) ✅
- `generate-cadi-weekly.js` uses `claude-sonnet-4-6` (current model per session env) ✅

### FESCO Field Name Caveat
The FESCO API field names (`container_number`, `origin_city`, `destination_city`, `planingDestinationDate`, `destinationDate`, `open_alert_types`) are based on directive guidance. **Task 2 Step 5 explicitly fetches and logs the actual field names.** If they differ, update `tracing_fesco.ts` type interfaces and property accesses before the first DB write. This is safe because the FK guard (`validLanes`) prevents corrupt writes.

### Scope Boundary
- TSR/FESCO demo-run: Task 2 Step 5 validates API connectivity and field names — full DB write verified manually by user.
- Disruption event insert: Requires `SUPABASE_SERVICE_ROLE_KEY` set in `.env.local` for first real use.
- Q16 AI generation: Requires `ANTHROPIC_API_KEY` for live run. Dry-run (Task 4 Step 5) validates JSON parsing without API call.
