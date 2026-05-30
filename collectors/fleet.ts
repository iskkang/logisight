// collectors/fleet.ts
// ì»¨í…Œì´ë„ˆ ì„ ì‚¬ ì„ ë³µëŸ‰ ìˆ˜ì§‘ê¸°
// ëŒ€ìƒ: Alphaliner Top 12 (ë¬´ë£Œ ê³µê°œ í—¤ë“œë¼ì¸)

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

  // Top 12 ì„ ì‚¬ íŒŒì‹± (í…Œì´ë¸” êµ¬ì¡°)
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
        error_message: carriers.length < 5 ? `ì„ ì‚¬ ${carriers.length}ê°œë§Œ íŒŒì‹±ë¨` : undefined,
      });
      console.log(`âœ… fleet: Top ${carriers.length}ê°œ ì„ ì‚¬ ìˆ˜ì§‘`);
    } else {
      throw new Error('ì„ ì‚¬ ë°ì´í„° ì—†ìŒ â€” íŽ˜ì´ì§€ êµ¬ì¡° ë³€ê²½ ê°€ëŠ¥ì„±');
    }

  } catch (error) {
    console.error('âŒ fleet ìˆ˜ì§‘ ì‹¤íŒ¨:', (error as Error).message);
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
