// collectors/utils/supabase_writer.ts
// Shared Supabase write helpers for all collectors.
// Returns silently if SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set.
import ws from 'ws';
// @ts-ignore — Node 20 lacks a native WebSocket; Supabase Realtime requires it
globalThis.WebSocket = ws as never;

import { createClient } from '@supabase/supabase-js';

let _client: ReturnType<typeof createClient> | null = null;

function getClient() {
  if (_client) return _client;
  const url  = process.env.SUPABASE_URL;
  const key  = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  _client = createClient(url, key, {
    auth: { persistSession: false },
    realtime: { enabled: false } as never,
  });
  return _client;
}

export async function dbUpsert(
  table: string,
  rows: Record<string, unknown>[],
  onConflict: string
): Promise<void> {
  if (!rows.length) return;
  const sb = getClient();
  if (!sb) {
    console.warn(`[db] env missing — skipping ${table} upsert (${rows.length} rows)`);
    return;
  }
  const { error } = await sb.from(table).upsert(rows as never[], { onConflict });
  if (error) throw new Error(`[db] ${table} upsert failed: ${error.message}`);
  console.log(`[db] ${table} ← ${rows.length} rows upserted`);
}

export async function dbDeleteBefore(
  table: string,
  dateColumn: string,
  cutoffIso: string
): Promise<void> {
  const sb = getClient();
  if (!sb) return;
  const { error } = await sb.from(table).delete().lt(dateColumn, cutoffIso);
  if (error) console.warn(`[db] ${table} delete failed: ${error.message}`);
}
