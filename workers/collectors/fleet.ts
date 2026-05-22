// workers/collectors/fleet.ts
// 컨테이너 선사 선복량 수집기
// 대상: Alphaliner Top 12 (무료 공개 헤드라인)

import { rateLimited } from './utils/rate_limiter';
import { snapshotWriter } from './utils/snapshot_writer';
import type { CollectorResult } from './types';

const ALPHALINER_URL = 'https://alphaliner.axsmarine.com/PublicPage/index.php?page=front';

async function fetchAlphalinerTop12() {
  const res = await fetch(ALPHALINER_URL, {
    headers: { 'User-Agent': 'Logisight/1.0 (logisight.mtlship.com; bot)' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();

  // Top 12 선사 파싱 (테이블 구조)
  const carriers: Array<{ rank: number; name: string; teu: number | null; share: number | null }> = [];
  const rows = html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi);

  let rank = 1;
  for (const row of rows) {
    if (rank > 12) break;
    const cells = row[1].match(/<td[^>]*>([\s\S]*?)<\/td>/gi) || [];
    if (cells.length >= 3) {
      const name = cells[1]?.replace(/<[^>]*>/g, '').trim() || '';
      const teuStr = cells[2]?.replace(/<[^>]*>/g, '').replace(/,/g, '').trim() || '';
      const shareStr = cells[3]?.replace(/<[^>]*>/g, '').replace(/%/g, '').trim() || '';

      if (name && name.length > 2 && name.length < 30) {
        carriers.push({
          rank,
          name,
          teu: teuStr ? parseInt(teuStr) || null : null,
          share: shareStr ? parseFloat(shareStr) || null : null,
        });
        rank++;
      }
    }
  }

  return carriers;
}

export async function collect(): Promise<CollectorResult> {
  const result: CollectorResult = { section: 'shipping', data: [] };

  try {
    const carriers = await rateLimited(ALPHALINER_URL, () => fetchAlphalinerTop12());

    if (carriers.length > 0) {
      result.data.push({
        data_type: 'fleet',
        data_key: 'ALPHALINER_TOP12',
        data_value: {
          carriers,
          date: new Date().toISOString().slice(0, 10),
          source: 'Alphaliner',
          source_url: ALPHALINER_URL,
        },
        source: 'Alphaliner',
        source_url: ALPHALINER_URL,
        is_complete: carriers.length >= 5,
        error_message: carriers.length < 5 ? `선사 ${carriers.length}개만 파싱됨` : undefined,
      });
      console.log(`✅ fleet: Top ${carriers.length}개 선사 수집`);
    } else {
      throw new Error('선사 데이터 없음 — 페이지 구조 변경 가능성');
    }

  } catch (error) {
    console.error('❌ fleet 수집 실패:', (error as Error).message);
    result.data.push({
      data_type: 'fleet',
      data_key: 'ALPHALINER_TOP12',
      data_value: {},
      source: 'Alphaliner',
      source_url: ALPHALINER_URL,
      is_complete: false,
      error_message: (error as Error).message,
    });
  }

  return result;
}

if (require.main === module) {
  collect().then(r => snapshotWriter(r)).catch(console.error);
}
