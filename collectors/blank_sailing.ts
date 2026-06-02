// collectors/blank_sailing.ts
// 블랭크 세일링 수집기 — EconDB omissions-time-series JSON API
// 이전 구현 (Playwright + Drewry) 대체: EconDB가 무료 JSON 제공, Playwright 불필요
//
// 측정 단위 주의: EconDB는 결항 "선복(TEU)" 을 region별로 제공한다.
// Drewry 의 결항 "편수(voyage)" / 항로·얼라이언스 분해와는 측정 대상이 다르다.
// 리포트 헤드라인(편수/항로)은 별도 Drewry 인용으로 보완한다.
//
// 설정값은 collectors/config/blank_sailing.json 으로 외부화 (필드명·분모·타임아웃).

import fs from 'fs';
import path from 'path';
import { rateLimited } from './utils/rate_limiter';
import { snapshotWriter } from './utils/snapshot_writer';
import { dbUpsert } from './utils/supabase_writer';
import type { CollectorResult } from './types';

interface BlankSailingConfig {
  endpoint: string;
  regions: string[];
  field_map: { date: string; blanked_teu: string; capacity_teu: string };
  denominator: 'proforma' | 'actual';
  timeout_ms: number;
}

const CONFIG: BlankSailingConfig = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, 'config/blank_sailing.json'), 'utf-8')
);

interface EconRow {
  week_start:  string;
  region:      string;
  blanked_teu: number | null;
  planned_teu: number | null;   // 분모 (denominator 설정에 따라 proforma 또는 actual)
  blank_pct:   number | null;
}

async function fetchEconDB(region: string): Promise<EconRow[]> {
  const url = `${CONFIG.endpoint}?region=${encodeURIComponent(region)}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Logisight/1.0' },
    signal: AbortSignal.timeout(CONFIG.timeout_ms),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json() as {
    plots?: Array<{ data: Array<Record<string, unknown>> }>
  };
  const items = data?.plots?.[0]?.data ?? [];
  const { date: kDate, blanked_teu: kBlanked, capacity_teu: kCapacity } = CONFIG.field_map;

  return items.map((item) => {
    const blanked  = (item[kBlanked]  as number | null) ?? null;
    const actual   = (item[kCapacity] as number | null) ?? null;
    // 'Actual capacity' = 결항 후 실배선 선복. 결항률 분모는 proforma(=결항+실배선).
    const planned  = CONFIG.denominator === 'proforma'
      ? (blanked != null && actual != null ? blanked + actual : null)
      : actual;
    const blank_pct =
      blanked != null && planned != null && planned > 0
        ? Math.round(blanked / planned * 10000) / 100
        : null;
    return {
      week_start: String(item[kDate]),
      region,
      blanked_teu: blanked,
      planned_teu: planned,
      blank_pct,
    };
  });
}

async function persistBlankSailings(allRows: EconRow[]): Promise<void> {
  if (!allRows.length) return;

  await dbUpsert(
    'blank_sailings',
    allRows.map(r => ({
      week_start: r.week_start, region: r.region,
      blanked_teu: r.blanked_teu, planned_teu: r.planned_teu,
      blank_pct: r.blank_pct, source: 'EconDB',
    })),
    'week_start,region'
  );
  // 정시성(schedule_reliability) proxy 제거됨:
  //   (100 - 결항률)은 실제 정시성(AIS 실도착 vs 공시 도착)과 무관한 별개 지표로,
  //   리포트에 정시성으로 노출 시 오정보가 된다. 정시성은 전용 소스(Sea-Intelligence 등)로 별도 수집할 것.
}

export async function collect(): Promise<CollectorResult> {
  const result: CollectorResult = { section: 'shipping', data: [] };
  const allRows: EconRow[] = [];

  for (const region of CONFIG.regions) {
    try {
      const rows = await rateLimited(CONFIG.endpoint, () => fetchEconDB(region));
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
          source_url: `${CONFIG.endpoint}?region=${encodeURIComponent(region)}`,
        },
        source:     'EconDB',
        source_url: `${CONFIG.endpoint}?region=${encodeURIComponent(region)}`,
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
        source_url: `${CONFIG.endpoint}?region=${encodeURIComponent(region)}`,
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
