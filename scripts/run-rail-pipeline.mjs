import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import dotenv from 'dotenv';
import WebSocket from 'ws';
import { createClient } from '@supabase/supabase-js';

if (existsSync('.env.local')) dotenv.config({ path: '.env.local' });
else dotenv.config();

globalThis.WebSocket = WebSocket;

const require = createRequire(import.meta.url);
const { collectBnsf } = require('../src/rail/collectors/bnsf');
const { ruleParseEvent } = require('../src/rail/ruleParseEvent');
const { matchCorridors } = require('../src/rail/matchCorridors');
const { scoreEvent } = require('../src/rail/scoreEvent');
const { recomputeCorridorStatus } = require('../src/rail/recomputeStatus');

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  throw new Error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
}

const supabase = createClient(url, key, {
  auth: { persistSession: false },
  realtime: { enabled: false },
});

function toISODate(value) {
  const cleaned = String(value || '').replace(/^Date\s*/i, '').trim();
  const date = new Date(cleaned);
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : null;
}

function formatStatus(status) {
  return `  ${status.corridor_code.padEnd(14)} ${String(status.status).padEnd(8)} score=${status.score ?? '-'} source=${status.source ?? '-'}`;
}

async function main() {
  const collected = await collectBnsf();
  if (collected.errors.length) console.warn('[bnsf errors]', collected.errors);
  console.log('[bnsf] fetched:', collected.items.length);

  const sourceUids = collected.items.map((item) => item.source_uid);
  const { data: existing, error: existingError } = await supabase
    .from('rail_events')
    .select('source_uid, checksum')
    .eq('source', 'bnsf')
    .in('source_uid', sourceUids.length ? sourceUids : ['__none__']);
  if (existingError) throw new Error(`rail_events existing read: ${JSON.stringify(existingError)}`);

  const seen = new Map((existing ?? []).map((event) => [event.source_uid, event.checksum]));

  const newRows = [];
  let mapped = 0;
  let unmapped = 0;

  for (const item of collected.items) {
    if (seen.get(item.source_uid) === item.checksum) continue;

    const parsed = ruleParseEvent(`${item.title}\n${item.body}`, {
      source: 'bnsf',
      id: item.source_uid,
      location_text: item.title,
    });
    const match = matchCorridors(parsed);
    const score = scoreEvent(parsed, match.scope);

    if (match.corridorCodes.length) mapped += 1;
    else unmapped += 1;

    newRows.push({
      source: 'bnsf',
      source_uid: item.source_uid,
      checksum: item.checksum,
      event_type: parsed.event_type,
      severity: parsed.severity,
      railroad: parsed.railroad,
      location_text: parsed.location_text,
      affected_corridors: match.corridorCodes,
      scope: match.scope,
      score,
      summary: parsed.summary,
      evidence_text: item.body.slice(0, 1000),
      confidence_score: parsed.confidence_score,
      start_date: toISODate(item.date),
      end_date: null,
    });
  }

  console.log(`[bnsf] new/changed: ${newRows.length} (mapped ${mapped} / unmapped ${unmapped})`);

  if (newRows.length) {
    const { error } = await supabase.from('rail_events').upsert(newRows, { onConflict: 'source,source_uid' });
    if (error) throw new Error(`rail_events upsert: ${JSON.stringify(error)}`);
  }

  const sinceISO = new Date(Date.now() - 21 * 864e5).toISOString().slice(0, 10);
  const { data: recent, error: recentError } = await supabase.from('rail_events').select('*').gte('start_date', sinceISO);
  if (recentError) throw new Error(`rail_events read: ${JSON.stringify(recentError)}`);

  const railEventsRowCount = recent?.length ?? 0;
  const recentMapped = (recent ?? []).filter((row) => (row.affected_corridors ?? []).length > 0).length;
  const recentUnmapped = railEventsRowCount - recentMapped;
  console.log(`[rail_events] recent rows since ${sinceISO}: ${railEventsRowCount} (mapped ${recentMapped} / unmapped ${recentUnmapped})`);

  const scored = (recent ?? [])
    .filter((row) => (row.affected_corridors ?? []).length > 0)
    .map((row) => ({
      id: row.id,
      corridorCodes: row.affected_corridors,
      scope: row.scope,
      score: row.score,
      event_type: row.event_type,
      summary: row.summary,
      source: row.source,
    }));

  const statuses = recomputeCorridorStatus(scored);
  const now = new Date().toISOString();
  const statusRows = statuses.map((status) => ({ ...status, updated_at: now }));
  const { error: statusError } = await supabase
    .from('rail_corridor_status')
    .upsert(statusRows, { onConflict: 'corridor_code' });
  if (statusError) throw new Error(`rail_corridor_status upsert: ${JSON.stringify(statusError)}`);

  console.log('\n=== corridor status ===');
  for (const status of statuses) console.log(formatStatus(status));

  const unmappedRows = (recent ?? []).filter(
    (row) => (row.affected_corridors ?? []).length === 0 && row.event_type !== 'unknown',
  );
  if (unmappedRows.length) {
    console.log('\n=== unmapped events (review landmarks) ===');
    for (const row of unmappedRows.slice(0, 15)) {
      console.log(`  [${row.event_type}] ${row.railroad} - ${row.location_text}`);
    }
  } else {
    console.log('\n=== unmapped events (review landmarks) ===');
    console.log('  (none)');
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
