// collectors/carrier_advisories.ts
// ì„ ì‚¬ Customer Advisory ìˆ˜ì§‘ê¸° â€” Playwright headless
// ëŒ€ìƒ: Maersk, MSC, CMA CGM, Hapag-Lloyd, ONE, HMM, COSCO, Yang Ming

import { chromium, type Browser } from 'playwright';
import { rateLimited } from './utils/rate_limiter';
import { snapshotWriter } from './utils/snapshot_writer';
import type { CollectorResult, NewsItem } from './types';

// ì„ ì‚¬ advisory í‚¤ì›Œë“œ â€” ì´ í‚¤ì›Œë“œê°€ ìžˆìœ¼ë©´ importance_hint: 'high'
const HIGH_IMPORTANCE_KEYWORDS = [
  'blank sailing', 'void sailing', 'service suspension', 'port omission',
  'surcharge', 'gri', 'pss', 'efs', 'war risk', 'red sea', 'disruption',
  'deviation', 'cancelled', 'omit', 'emergency', 'service alert',
];

interface CarrierSource {
  name: string;
  url: string;
  selectors: string[];  // ìˆœì„œëŒ€ë¡œ ì‹œë„, ì²« ë²ˆì§¸ ì„±ê³µ ì‚¬ìš©
}

const CARRIERS: CarrierSource[] = [
  {
    name: 'Maersk',
    url: 'https://www.maersk.com/news',
    selectors: ['[data-test="news-item"] a', 'article a', '.news-card a', 'h3 a', 'h2 a'],
  },
  {
    name: 'MSC',
    url: 'https://www.msc.com/en/newsroom/customer-advisories',
    selectors: ['.advisory-item a', 'article a', 'h3 a', 'h2 a', 'li a'],
  },
  {
    name: 'CMA CGM',
    url: 'https://www.cma-cgm.com/latest-news',
    selectors: ['.news-item a', 'article a', 'h2 a', 'h3 a'],
  },
  {
    name: 'Hapag-Lloyd',
    url: 'https://www.hapag-lloyd.com/en/services-information/operational-updates/overview.html',
    selectors: ['.update-item a', '.news-list a', 'article a', 'h3 a', 'h2 a'],
  },
  {
    name: 'ONE',
    url: 'https://www.one-line.com/en/news/156/all-years/all-months',
    selectors: ['.news-list a', 'article a', 'h3 a', 'h2 a'],
  },
  {
    name: 'HMM',
    url: 'https://www.hmm21.com/company/newsList.do',
    selectors: ['.board-list a', 'td a', '.title a', 'h3 a'],
  },
  {
    name: 'COSCO',
    url: 'https://lines.coscoshipping.com/',
    selectors: ['.news-item a', 'article a', 'h2 a', 'h3 a'],
  },
  {
    name: 'Yang Ming',
    url: 'https://www.yangming.com/en/about_us/news/notice',
    selectors: ['.notice-list a', 'article a', 'h3 a', 'td a'],
  },
];

function detectImportance(title: string): 'high' | 'normal' {
  const lower = title.toLowerCase();
  return HIGH_IMPORTANCE_KEYWORDS.some(kw => lower.includes(kw)) ? 'high' : 'normal';
}

async function scrapeCarrier(browser: Browser, carrier: CarrierSource): Promise<NewsItem[]> {
  const page = await browser.newPage();
  try {
    await page.goto(carrier.url, { waitUntil: 'domcontentloaded', timeout: 20000 });

    // ê° ì…€ë ‰í„°ë¥¼ ìˆœì„œëŒ€ë¡œ ì‹œë„
    for (const selector of carrier.selectors) {
      const items = await page.evaluate((sel) => {
        const links = Array.from(document.querySelectorAll(sel));
        const seen = new Set<string>();
        return links
          .map(a => ({
            title: (a as HTMLElement).textContent?.trim().replace(/\s+/g, ' ') || '',
            url: (a as HTMLAnchorElement).href || '',
          }))
          .filter(item => {
            if (item.title.length < 8 || item.title.length > 200) return false;
            if (!item.url || item.url.includes('#') || item.url.includes('javascript')) return false;
            if (seen.has(item.title)) return false;
            seen.add(item.title);
            return true;
          })
          .slice(0, 5);
      }, selector);

      if (items.length > 0) {
        return items.map(item => ({
          title: item.title,
          url: item.url,
          published_at: new Date().toISOString(),
          summary_en: '',
          source: carrier.name,
        }));
      }
    }
    return [];
  } catch (e) {
    console.log(`âš ï¸ ${carrier.name} scrape ì‹¤íŒ¨: ${(e as Error).message}`);
    return [];
  } finally {
    await page.close();
  }
}

export async function collect(): Promise<CollectorResult> {
  const result: CollectorResult = { section: 'carrier_advisory', data: [] };
  let browser: Browser | null = null;

  try {
    browser = await chromium.launch({ headless: true });

    for (const carrier of CARRIERS) {
      try {
        const items = await rateLimited(carrier.url, () => scrapeCarrier(browser!, carrier));
        for (const item of items) {
          const importance = detectImportance(item.title);
          result.data.push({
            data_type: 'news',
            data_key: `CARRIER_${carrier.name}_${Date.now()}_${Math.random().toString(36).slice(2)}`,
            data_value: { ...item, section: 'carrier_advisory', language: 'en', category: 'carrier_advisory', importance_hint: importance },
            source: carrier.name,
            source_url: carrier.url,
            is_complete: true,
          });
        }
        console.log(`âœ… ${carrier.name}: ${items.length}ê±´ (high: ${items.filter(i => detectImportance(i.title) === 'high').length}ê±´)`);
      } catch (e) {
        console.log(`âš ï¸ ${carrier.name} ì „ì²´ ì‹¤íŒ¨: ${(e as Error).message}`);
        result.data.push({ data_type: 'news', data_key: `${carrier.name}_error`, data_value: {}, source: carrier.name, source_url: carrier.url, is_complete: false, error_message: (e as Error).message });
      }
    }
  } finally {
    if (browser) await browser.close();
  }

  const success = result.data.filter(d => d.is_complete).length;
  console.log(`\nâœ… carrier_advisories: ${success}ê±´ ìˆ˜ì§‘ ì™„ë£Œ`);
  return result;
}

if (require.main === module) {
  collect().then(r => snapshotWriter(r)).catch(console.error);
}
