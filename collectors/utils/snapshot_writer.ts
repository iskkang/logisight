// collectors/utils/snapshot_writer.ts
// Phase 1: writes CollectorResult to content/drafts/latest-news.json.
// Phase 2 (Supabase): replace the fs block with a Supabase upsert.

import * as fs from 'fs';
import * as path from 'path';
import type { CollectorResult } from '../types';

const OUTPUT_PATH = path.resolve(__dirname, '../../content/drafts/latest-news.json');

interface NewsOutput {
  date: string;
  shipping: object[];
  air: object[];
  rail: object[];
  trade: object[];
  carrier_advisory: object[];
  risk: object[];
}

function loadExisting(): NewsOutput {
  if (fs.existsSync(OUTPUT_PATH)) {
    try {
      return JSON.parse(fs.readFileSync(OUTPUT_PATH, 'utf-8'));
    } catch {
      // corrupted — start fresh
    }
  }
  return { date: '', shipping: [], air: [], rail: [], trade: [], carrier_advisory: [], risk: [] };
}

const ROLL_DAYS = 35;   // 30일 롤링 + 여유 5일
const SECTIONS_TO_CLEAN = ['shipping', 'air', 'rail', 'trade', 'carrier_advisory', 'risk'] as const;

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

  // ── URL dedup + 35일 롤링 ─────────────────────────────────────────
  // 지표 항목(published_at·url 없음)은 두 조건 모두 건너뜀 → 항상 보존
  const cutoff = Date.now() - ROLL_DAYS * 86400000;
  for (const key of SECTIONS_TO_CLEAN) {
    const arr = (output as unknown as Record<string, any[]>)[key] ?? [];
    const seen = new Set<string>();
    const cleaned: any[] = [];
    // 최신이 뒤에 push되므로 역순 → 최신 항목 우선 보존
    for (let i = arr.length - 1; i >= 0; i--) {
      const it = arr[i];
      if (it?.published_at) {
        const t = new Date(it.published_at).getTime();
        if (!isNaN(t) && t < cutoff) continue;   // 35일 초과 → 제거
      }
      // url 있으면 URL로 dedup, 없으면 name+date 복합 키로 dedup (지표 항목 중복 방지)
      const dedupeKey: string | null = it?.url ?? (it?.name && it?.date ? `${it.name}|${it.date}` : null);
      if (dedupeKey) {
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);
      }
      cleaned.push(it);
    }
    cleaned.reverse();   // 원래 시간순 복원
    (output as unknown as Record<string, any[]>)[key] = cleaned;
  }

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2), 'utf-8');

  const ok = result.data.filter(d => d.is_complete).length;
  console.log(`\n📦 snapshot [${result.section}] — ${ok}/${result.data.length} 성공, +${added}건 (dedup·롤링 후 정리) → latest-news.json`);
}
