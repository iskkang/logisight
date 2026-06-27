// collectors/index1520-charts.ts
// index1520(ERAI) 차트 스냅샷 → eurasia_charts(jsonb). 프론트(Vercel SSR)는 이 테이블만 읽는다(백엔드 직접 호출 금지).
// 공개 JSON 엔드포인트 2개를 통째 저장. 실패한 엔드포인트는 upsert에서 제외(기존 스냅샷 유지).
import { rateLimited } from './utils/rate_limiter';
import { snapshotWriter } from './utils/snapshot_writer';
import { dbUpsert } from './utils/supabase_writer';
import type { CollectorResult } from './types';

const QUOTES_URL = 'https://index1520.com/ajax/index-quotes.php?page=main&lang=en';
const GEO_URL = 'https://index1520.com/StatisticsAPI/clickhouse/geo/?language=en&direction=all';
const SOURCE = 'ERAI';
const BOT_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Accept': 'application/json',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer': 'https://index1520.com/en/index/',
};

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, { headers: BOT_HEADERS, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function collect(): Promise<CollectorResult> {
  const result: CollectorResult = { section: 'shipping', data: [] };
  const rows: Record<string, unknown>[] = [];
  const now = new Date().toISOString();
  const okKeys: string[] = [];

  const targets = [
    { key: 'index_quotes', url: QUOTES_URL, source_url: 'https://index1520.com/en/index/', valid: (p: any) => p && p.indexes && p.indexes.datasets },
    { key: 'geo', url: GEO_URL, source_url: 'https://index1520.com/en/statistics/', valid: (p: any) => p && Array.isArray(p.data) },
  ];

  for (const t of targets) {
    try {
      const payload = await rateLimited(t.url, () => fetchJson(t.url));
      if (!t.valid(payload)) throw new Error('unexpected payload shape');
      rows.push({ key: t.key, payload, source: SOURCE, source_url: t.source_url, updated_at: now });
      okKeys.push(t.key);
      result.data.push({ data_type: 'snapshot', data_key: t.key, data_value: { key: t.key, source: SOURCE, source_url: t.source_url }, source: SOURCE, source_url: t.source_url, is_complete: true });
    } catch (err) {
      const msg = (err as Error).message;
      console.warn(`⚠️ index1520-charts ${t.key} 실패: ${msg} (기존 스냅샷 유지)`);
      result.data.push({ data_type: 'snapshot', data_key: t.key, data_value: {}, source: SOURCE, source_url: t.source_url, is_complete: false, error_message: msg });
    }
  }

  console.log(`[index1520-charts] ${okKeys.length ? okKeys.map((k) => `${k} ok`).join(' / ') : '수집 0 — 스냅샷 유지'}`);

  // 성공한 것만 upsert(실패 엔드포인트는 덮어쓰지 않음).
  if (rows.length) {
    await dbUpsert('eurasia_charts', rows, 'key').catch((e) =>
      console.warn('[eurasia_charts] persist 실패:', (e as Error).message));
  }

  return result;
}

if (require.main === module) {
  collect().then((r) => snapshotWriter(r)).catch(console.error);
}
