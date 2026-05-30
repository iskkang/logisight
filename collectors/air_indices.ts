// workers/collectors/air_indices.ts
// 항공 화물 운임 지수 수집기
// 대상: Baltic Air Freight Index (BAI), Freightos Air Index (FAX), Jet Fuel

import { rateLimited } from './utils/rate_limiter';
import { snapshotWriter } from './utils/snapshot_writer';
import type { CollectorResult } from './types';

// ── Baltic Air Freight Index (BAI) ──────────────────────────────
async function fetchBAI(): Promise<{ value: number | null; change: number | null }> {
  const url = 'https://www.balticexchange.com/en/data/market-data/air.html';
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Logisight/1.0 (logisight.mtlship.com; bot)' },
    });
    const html = await res.text();
    const match = html.match(/BAI[^0-9]*?([\d,]+(?:\.\d+)?)/i);
    return {
      value: match ? parseFloat(match[1].replace(/,/g, '')) : null,
      change: null,
    };
  } catch {
    return { value: null, change: null };
  }
}

// ── Freightos Air Index (FAX) ────────────────────────────────────
async function fetchFAX(): Promise<{ value: number | null; change: number | null }> {
  const url = 'https://fbx.freightos.com/air';
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Logisight/1.0 (logisight.mtlship.com; bot)' },
    });
    const html = await res.text();
    const match = html.match(/FAX[^0-9]*?([\d,]+(?:\.\d+)?)/i)
      || html.match(/air[^0-9]*?\$\s*([\d,]+(?:\.\d+)?)/i);
    return {
      value: match ? parseFloat(match[1].replace(/,/g, '')) : null,
      change: null,
    };
  } catch {
    return { value: null, change: null };
  }
}

// ── Jet Fuel (IATA) ──────────────────────────────────────────────
async function fetchJetFuel(): Promise<{ value: number | null; change: number | null }> {
  const url = 'https://www.iata.org/en/publications/economics/fuel-monitor/';
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Logisight/1.0 (logisight.mtlship.com; bot)' },
    });
    const html = await res.text();
    // IATA 연료 모니터: $/gallon 또는 $/barrel 수치 추출
    const match = html.match(/([\d.]+)\s*(?:USD\s*)?\/\s*(?:gallon|gal|bbl)/i);
    return {
      value: match ? parseFloat(match[1]) : null,
      change: null,
    };
  } catch {
    return { value: null, change: null };
  }
}

export async function collect(): Promise<CollectorResult> {
  const result: CollectorResult = { section: 'air', data: [] };

  const indices = [
    {
      key: 'BAI',
      name: 'Baltic Air Freight Index',
      unit: 'point',
      source_url: 'https://www.balticexchange.com/en/data/market-data/air.html',
      fetcher: () => fetchBAI(),
    },
    {
      key: 'FAX',
      name: 'Freightos Air Index',
      unit: '$/kg',
      source_url: 'https://fbx.freightos.com/air',
      fetcher: () => fetchFAX(),
    },
    {
      key: 'JET_FUEL',
      name: 'Jet Fuel (IATA)',
      unit: '$/gallon',
      source_url: 'https://www.iata.org/en/publications/economics/fuel-monitor/',
      fetcher: () => fetchJetFuel(),
    },
  ];

  for (const idx of indices) {
    try {
      const data = await rateLimited(idx.source_url, idx.fetcher);
      result.data.push({
        data_type: 'air_index',
        data_key: idx.key,
        data_value: {
          name: idx.name,
          value: data.value,
          change_pct: data.change,
          unit: idx.unit,
          date: new Date().toISOString().slice(0, 10),
          source: idx.name,
          source_url: idx.source_url,
        },
        source: idx.name,
        source_url: idx.source_url,
        is_complete: data.value !== null,
        error_message: data.value === null ? '데이터 파싱 실패' : undefined,
      });
    } catch (error) {
      result.data.push({
        data_type: 'air_index',
        data_key: idx.key,
        data_value: {},
        source: idx.name,
        source_url: idx.source_url,
        is_complete: false,
        error_message: (error as Error).message,
      });
    }
  }

  const success = result.data.filter(d => d.is_complete).length;
  console.log(`✅ air_indices: ${success}/${result.data.length}개 수집`);

  return result;
}

if (require.main === module) {
  collect().then(r => snapshotWriter(r)).catch(console.error);
}
