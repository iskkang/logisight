// workers/collectors/bunker.ts
// 벙커유 가격 수집기
// 대상: Ship & Bunker (IFO380, VLSFO, MGO — 싱가포르·로테르담·휴스턴)

import { rateLimited } from './utils/rate_limiter';
import { snapshotWriter } from './utils/snapshot_writer';
import type { CollectorResult } from './types';

const BUNKER_URL = 'https://shipandbunker.com/prices';

async function fetchBunkerPrices(): Promise<Array<{
  port: string;
  fuel: string;
  price: number | null;
  currency: string;
  unit: string;
}>> {
  const res = await fetch(BUNKER_URL, {
    headers: {
      'User-Agent': 'Logisight/1.0 (logisight.mtlship.com; bot)',
      'Accept': 'text/html',
    },
  });

  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();

  const results: Array<{ port: string; fuel: string; price: number | null; currency: string; unit: string }> = [];

  // Ship & Bunker 주요 항구 가격 파싱
  // 패턴: 숫자 앞뒤에 VLSFO/IFO/MGO 텍스트
  const pricePattern = /(\d{2,4}(?:\.\d+)?)/g;

  // 주요 연료별 가격 추출 시도
  const fuelTypes = [
    { key: 'VLSFO', regex: /VLSFO[^0-9]*?([\d,]+(?:\.\d+)?)/i },
    { key: 'IFO380', regex: /IFO\s*380[^0-9]*?([\d,]+(?:\.\d+)?)/i },
    { key: 'MGO', regex: /MGO[^0-9]*?([\d,]+(?:\.\d+)?)/i },
    { key: 'LSMGO', regex: /LSMGO[^0-9]*?([\d,]+(?:\.\d+)?)/i },
  ];

  for (const fuel of fuelTypes) {
    const match = html.match(fuel.regex);
    if (match) {
      results.push({
        port: 'Global Average',
        fuel: fuel.key,
        price: parseFloat(match[1].replace(/,/g, '')),
        currency: 'USD',
        unit: '$/MT',
      });
    } else {
      results.push({
        port: 'Global Average',
        fuel: fuel.key,
        price: null,
        currency: 'USD',
        unit: '$/MT',
      });
    }
  }

  return results;
}

export async function collect(): Promise<CollectorResult> {
  const result: CollectorResult = { section: 'shipping', data: [] };

  try {
    const prices = await rateLimited(BUNKER_URL, () => fetchBunkerPrices());

    for (const p of prices) {
      result.data.push({
        data_type: 'bunker',
        data_key: `BUNKER_${p.fuel}`,
        data_value: {
          ...p,
          date: new Date().toISOString().slice(0, 10),
          source: 'Ship & Bunker',
          source_url: BUNKER_URL,
        },
        source: 'Ship & Bunker',
        source_url: BUNKER_URL,
        is_complete: p.price !== null,
        error_message: p.price === null ? '가격 파싱 실패' : undefined,
      });
    }

    const success = result.data.filter(d => d.is_complete).length;
    console.log(`✅ bunker: ${success}/${result.data.length}개 수집 완료`);

  } catch (error) {
    console.error('❌ bunker 수집 실패:', (error as Error).message);
    for (const fuel of ['VLSFO', 'IFO380', 'MGO']) {
      result.data.push({
        data_type: 'bunker',
        data_key: `BUNKER_${fuel}`,
        data_value: {},
        source: 'Ship & Bunker',
        source_url: BUNKER_URL,
        is_complete: false,
        error_message: (error as Error).message,
      });
    }
  }

  return result;
}

if (require.main === module) {
  collect().then(r => snapshotWriter(r)).catch(console.error);
}
