// workers/collectors/utils/snapshot_writer.ts
// Phase 1: writes CollectorResult to content/drafts/latest-news.json.
// Phase 2 (Supabase): replace the fs block with a Supabase upsert.

import * as fs from 'fs';
import * as path from 'path';
import type { CollectorResult } from '../types';

const OUTPUT_PATH = path.resolve(__dirname, '../../../content/drafts/latest-news.json');

interface NewsOutput {
  date: string;
  shipping: object[];
  air: object[];
  rail: object[];
  trade: object[];
}

function loadExisting(): NewsOutput {
  if (fs.existsSync(OUTPUT_PATH)) {
    try {
      return JSON.parse(fs.readFileSync(OUTPUT_PATH, 'utf-8'));
    } catch {
      // corrupted — start fresh
    }
  }
  return { date: '', shipping: [], air: [], rail: [], trade: [] };
}

export async function snapshotWriter(result: CollectorResult): Promise<void> {
  const output = loadExisting();
  output.date = new Date().toLocaleDateString('ko-KR');

  let added = 0;
  for (const item of result.data) {
    if (!item.is_complete) continue;
    const section: string = item.data_value?.section ?? result.section;
    if (section in output) {
      (output as unknown as Record<string, object[]>)[section].push(item.data_value);
      added++;
    }
  }

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2), 'utf-8');

  const ok = result.data.filter(d => d.is_complete).length;
  const total = result.data.length;
  console.log(`\n📦 snapshot [${result.section}] — ${ok}/${total} 성공, +${added}건 → latest-news.json`);
}
