// Shared RSS news collector for ocean, air, rail, trade, and logistics.

import { rateLimited } from './utils/rate_limiter';
import { snapshotWriter } from './utils/snapshot_writer';
import {
  enrichNewsItem,
  parseNewsFeed,
  persistCollectedNews,
} from './utils/news_enrichment';
import { sourcesFor, type NewsSection } from './news_sources';
import type { CollectorResult } from './types';

export async function collect(
  sections: NewsSection[] = ['shipping', 'air', 'rail', 'trade', 'logistics'],
): Promise<CollectorResult> {
  const result: CollectorResult = { section: 'shipping', data: [] };

  for (const source of sourcesFor(sections, 'rss')) {
    try {
      const items = await rateLimited(source.url, () => parseNewsFeed(source));
      const enriched = await Promise.all(items.map(enrichNewsItem));
      for (const item of enriched) {
        result.data.push({
          data_type: 'news',
          data_key: `${source.name}_${item.url}`,
          data_value: {
            ...item,
            section: source.section,
            language: source.language,
          },
          source: source.name,
          source_url: source.url,
          is_complete: true,
        });
      }
      console.log(`✅ ${source.name}: ${enriched.length}건 수집`);
    } catch (error) {
      console.error(`❌ ${source.name} 수집 실패:`, (error as Error).message);
      result.data.push({
        data_type: 'news',
        data_key: `${source.name}_error`,
        data_value: {},
        source: source.name,
        source_url: source.url,
        is_complete: false,
        error_message: (error as Error).message,
      });
    }
  }

  await persistCollectedNews(result).catch((error) =>
    console.warn('[maritime_news] Supabase persist skipped:', (error as Error).message),
  );
  return result;
}

if (require.main === module) {
  collect()
    .then(snapshotWriter)
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
