// workers/collectors/utils/snapshot_writer.ts
// Persists a CollectorResult snapshot.
// Phase 1 (no Supabase): console output only.
// Phase 2: replace the console block with a Supabase upsert.

import type { CollectorResult, CollectorData } from '../types';

function formatRow(item: CollectorData): string {
  const status = item.is_complete ? '✅' : '❌';
  const value = typeof item.data_value === 'object'
    ? JSON.stringify(item.data_value).slice(0, 120)
    : String(item.data_value);
  const suffix = item.error_message ? ` — ${item.error_message}` : '';
  return `  ${status} [${item.data_type}] ${item.data_key} | ${value}${suffix}`;
}

export async function snapshotWriter(result: CollectorResult): Promise<void> {
  const total = result.data.length;
  const ok = result.data.filter(d => d.is_complete).length;

  console.log(`\n📦 snapshot [${result.section}] — ${ok}/${total} complete`);
  for (const item of result.data) {
    console.log(formatRow(item));
  }
}
