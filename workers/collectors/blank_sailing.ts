// workers/collectors/blank_sailing.ts
// 블랭크 세일링 수집기 — EconDB omissions-time-series JSON API
// 이전 구현 (Playwright + Drewry) 대체: EconDB가 무료 JSON 제공, Playwright 불필요

import { rateLimited } from './utils/rate_limiter';
import { snapshotWriter } from './utils/snapshot_writer';
import { dbUpsert } from './utils/supabase_writer';
import type { CollectorResult } from './types';

const ECONDB_BASE = 'https://www.econdb.com/widgets/omissions-time-series/data/';

const REGIONS = [
  'East Asia',
  'Mediterranean',
  'Northwest Europe',
  'Indian Subcontinent',
  'Middle East',
  'North America East',
  'North America West',
] as const;

interface EconRow {
  week_start:  string;
  region:      string;
  blanked_teu: number | null;
  planned_teu: number | null;
  blank_pct:   number | null;
}

async function fetchEconDB(region: string): Promise<EconRow[]> {
  const url = `${ECONDB_BASE}?region=${encodeURIComponent(region)}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Logisight/1.0' },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json() as {
    plots?: Array<{ data: Array<Record<string, unknown>> }>
  };
  const items = data?.plots?.[0]?.data ?? [];
  return items.map((item) => {
    const blanked = (item['Blanked capacity'] as number | null) ?? null;
    const planned = (item['Actual capacity']  as number | null) ?? null;
    const blank_pct =
      blanked != null && planned != null && planned > 0
        ? Math.round(blanked / planned * 10000) / 100
        : null;
    return {
      week_start: String(item['Date']),
      region,
      blanked_teu: blanked,
      planned_teu: planned,
      blank_pct,
    };
  });
}

async function persistBlankSailings(allRows: EconRow[]): Promise<void> {
  if (!allRows.length) return;

  // blank_sailings
  await dbUpsert(
    'blank_sailings',
    allRows.map(r => ({
      week_start: r.week_start, region: r.region,
      blanked_teu: r.blanked_teu, planned_teu: r.planned_teu,
      blank_pct: r.blank_pct, source: 'EconDB',
    })),
    'week_start,region'
  );

  // schedule_reliability proxy: average blank_pct per week across all regions
  const byWeek = new Map<string, number[]>();
  for (const r of allRows) {
    if (r.blank_pct == null) continue;
    if (!byWeek.has(r.week_start)) byWeek.set(r.week_start, []);
    byWeek.get(r.week_start)!.push(r.blank_pct);
  }
  const srRows: Record<string, unknown>[] = [];
  for (const [week_start, pcts] of byWeek) {
    const avg = pcts.reduce((a, b) => a + b, 0) / pcts.length;
    srRows.push({
      week_start,
      on_time_pct: Math.round((100 - avg) * 100) / 100,
      data_type: 'proxy',
      source: 'EconDB (proxy)',
    });
  }
  await dbUpsert('schedule_reliability', srRows, 'week_start');
}

export async function collect(): Promise<CollectorResult> {
  const result: CollectorResult = { section: 'shipping', data: [] };
  const allRows: EconRow[] = [];

  for (const region of REGIONS) {
    try {
      const rows = await rateLimited(ECONDB_BASE, () => fetchEconDB(region));
      allRows.push(...rows);
      const latest = rows[rows.length - 1];
      result.data.push({
        data_type:  'blank_sailing',
        data_key:   `BLANK_${region.replace(/ /g, '_').toUpperCase()}`,
        data_value: {
          region, weeks_fetched: rows.length,
          latest_blank_pct: latest?.blank_pct ?? null,
          latest_week: latest?.week_start ?? null,
          source: 'EconDB',
          source_url: `${ECONDB_BASE}?region=${encodeURIComponent(region)}`,
        },
        source:     'EconDB',
        source_url: `${ECONDB_BASE}?region=${encodeURIComponent(region)}`,
        is_complete: rows.length > 0,
        error_message: rows.length === 0 ? '데이터 없음' : undefined,
      });
      console.log(`✅ blank_sailing [${region}]: ${rows.length}주 수집 (latest blank_pct: ${latest?.blank_pct ?? 'n/a'}%)`);
    } catch (e) {
      console.warn(`⚠️ blank_sailing [${region}] 실패: ${(e as Error).message}`);
      result.data.push({
        data_type: 'blank_sailing',
        data_key:  `BLANK_${region.replace(/ /g, '_').toUpperCase()}`,
        data_value: {}, source: 'EconDB',
        source_url: `${ECONDB_BASE}?region=${encodeURIComponent(region)}`,
        is_complete: false, error_message: (e as Error).message,
      });
    }
  }

  await persistBlankSailings(allRows).catch(e =>
    console.warn('[blank_sailings] Supabase persist skipped:', (e as Error).message)
  );

  const success = result.data.filter(d => d.is_complete).length;
  console.log(`✅ blank_sailing: ${success}/${result.data.length}개 수집 완료`);
  return result;
}

if (require.main === module) {
  collect().then(r => snapshotWriter(r)).catch(console.error);
}
