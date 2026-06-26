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
const { collectUp } = require('../src/rail/collectors/up');
const { collectCn } = require('../src/rail/collectors/cn');
const { collectNews } = require('../src/rail/collectors/news');
const {
  CATEGORY: PROGRESSIVE_RAILROADING_CATEGORY,
  collectProgressiveRailroading,
} = require('../src/rail/collectors/progressive-railroading');
const { ruleParseEvent } = require('../src/rail/ruleParseEvent');
const { matchCorridors } = require('../src/rail/matchCorridors');
const { scoreEvent } = require('../src/rail/scoreEvent');
const { recomputeCorridorStatus } = require('../src/rail/recomputeStatus');

const COLLECTORS = [collectBnsf, collectUp, collectCn];

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
  const namedMonth = cleaned.match(/^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})$/);
  if (namedMonth) {
    const months = new Map([
      ['january', '01'],
      ['jan', '01'],
      ['february', '02'],
      ['feb', '02'],
      ['march', '03'],
      ['mar', '03'],
      ['april', '04'],
      ['apr', '04'],
      ['may', '05'],
      ['june', '06'],
      ['jun', '06'],
      ['july', '07'],
      ['jul', '07'],
      ['august', '08'],
      ['aug', '08'],
      ['september', '09'],
      ['sep', '09'],
      ['sept', '09'],
      ['october', '10'],
      ['oct', '10'],
      ['november', '11'],
      ['nov', '11'],
      ['december', '12'],
      ['dec', '12'],
    ]);
    const month = months.get(namedMonth[1].toLowerCase());
    if (month) return `${namedMonth[3]}-${month}-${namedMonth[2].padStart(2, '0')}`;
  }

  const numeric = cleaned.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (numeric) return `${numeric[3]}-${numeric[1].padStart(2, '0')}-${numeric[2].padStart(2, '0')}`;

  const isoDate = cleaned.match(/^(\d{4}-\d{2}-\d{2})/);
  if (isoDate) return isoDate[1];

  const date = new Date(cleaned);
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : null;
}

function formatStatus(status) {
  return `  ${status.corridor_code.padEnd(14)} ${String(status.status).padEnd(8)} score=${status.score ?? '-'} source=${status.source ?? '-'}`;
}

async function main() {
  const newRows = [];

  const progressiveRailroading = await collectProgressiveRailroading({ supabase });
  if (progressiveRailroading.errors.length) console.warn('[PR errors]', progressiveRailroading.errors);
  console.log(`[PR producer] read ${progressiveRailroading.read} -> inserted ${progressiveRailroading.inserted} (maritime_news, category=${PROGRESSIVE_RAILROADING_CATEGORY})`);

  for (const collect of COLLECTORS) {
    const collected = await collect();
    if (collected.errors.length) console.warn(`[${collected.source} errors]`, collected.errors);
    console.log(`[${collected.source}] fetched:`, collected.items.length);

    const sourceUids = collected.items.map((item) => item.source_uid);
    const { data: existing, error: existingError } = await supabase
      .from('rail_events')
      .select('source_uid, checksum')
      .eq('source', collected.source)
      .in('source_uid', sourceUids.length ? sourceUids : ['__none__']);
    if (existingError) throw new Error(`rail_events existing read: ${JSON.stringify(existingError)}`);

    const seen = new Map((existing ?? []).map((event) => [event.source_uid, event.checksum]));

    let mapped = 0;
    let unmapped = 0;
    let changed = 0;

    for (const item of collected.items) {
      if (seen.get(item.source_uid) === item.checksum) continue;

      const parsed = ruleParseEvent(`${item.title}\n${item.body}`, {
        source: collected.source,
        id: item.source_uid,
        location_text: item.title,
        ...(collected.source === 'cn' ? { railroad: 'CN' } : {}),
      });
      const match = matchCorridors(parsed);
      const score = scoreEvent(parsed, match.scope);

      if (match.corridorCodes.length) mapped += 1;
      else unmapped += 1;
      changed += 1;

      newRows.push({
        source: collected.source,
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

    console.log(`[${collected.source}] new/changed: ${changed} (mapped ${mapped} / unmapped ${unmapped})`);
  }

  const news = await collectNews({ supabase, sinceDays: 21 });
  if (news.errors.length) console.warn('[news errors]', news.errors);
  console.log(`[news] read ${news.stats.read} -> mapped ${news.stats.mapped}`);

  const newsUids = news.rows.map((row) => row.source_uid);
  const { data: existingNews, error: existingNewsError } = await supabase
    .from('rail_events')
    .select('source, source_uid, checksum')
    .like('source', 'news:%')
    .in('source_uid', newsUids.length ? newsUids : ['__none__']);
  if (existingNewsError) throw new Error(`rail_events news existing read: ${JSON.stringify(existingNewsError)}`);

  const seenNews = new Map((existingNews ?? []).map((event) => [`${event.source}|${event.source_uid}`, event.checksum]));
  let changedNews = 0;
  for (const row of news.rows) {
    if (seenNews.get(`${row.source}|${row.source_uid}`) === row.checksum) continue;
    newRows.push(row);
    changedNews += 1;
  }
  console.log(`[news] new/changed: ${changedNews}`);

  if (news.rows.length) {
    console.log('\n=== mapped news events (precision review) ===');
    for (const row of news.rows) {
      console.log(`  [${row.source}] ${row.affected_corridors.join(',')} ${row.event_type} score=${row.score} - ${row.summary}`);
    }
  }

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
