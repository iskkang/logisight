// workers/collectors/news_industry.ts
// 업계·정부·기관 뉴스 수집기
// 대상: Maersk, DHL, SCANGL, KITA, NLIC, KOTRA, Tradlinx

import { chromium, type Browser, type Page } from 'playwright';
import { rateLimited } from './utils/rate_limiter';
import type { CollectorResult, NewsItem } from './types';

const SOURCES = [
  {
    name: 'Maersk',
    url: 'https://www.maersk.com/news',
    selector: 'a[href*="/news/"], article a, .news-card a',
    section: 'shipping' as const,
    language: 'en',
  },
  {
    name: 'DHL Forwarding',
    url: 'https://www.dhl.com/sg-en/home/global-forwarding/latest-news-and-webinars.html',
    selector: 'a[href*="news"], .news-item a, article a',
    section: 'shipping' as const,
    language: 'en',
  },
  {
    name: 'SCANGL',
    url: 'https://www.scangl.com/news/?news-list_search=&tag=News&currentPage=1',
    selector: '.news-list a, article a, h2 a, h3 a',
    section: 'shipping' as const,
    language: 'en',
  },
  {
    name: 'KITA',
    url: 'https://www.kita.net/shippers/board/newsList.do',
    selector: '.board-list a, td a, .title a',
    section: 'trade' as const,
    language: 'ko',
  },
  {
    name: 'NLIC',
    url: 'https://www.nlic.go.kr/nlic/newsArticleList.action',
    selector: '.list a, td a, .title a, .subject a',
    section: 'trade' as const,
    language: 'ko',
  },
  {
    name: 'KOTRA 물류',
    url: 'https://dream.kotra.or.kr/kotranews/cms/com/index.do?MENU_ID=70',
    selector: '.list-title a, .tit a, td a',
    section: 'trade' as const,
    language: 'ko',
  },
  {
    name: 'Tradlinx Blog',
    url: 'https://www.tradlinx.com/blog/guide/',
    selector: 'article a, .post-title a, h2 a, h3 a',
    section: 'shipping' as const,
    language: 'ko',
  },
];

async function scrapePage(page: Page, source: typeof SOURCES[0]): Promise<NewsItem[]> {
  await page.goto(source.url, { waitUntil: 'domcontentloaded', timeout: 25000 });

  // 정부 사이트는 로딩이 느릴 수 있으므로 추가 대기
  if (source.name === 'KITA' || source.name === 'NLIC' || source.name === 'KOTRA 물류') {
    await page.waitForTimeout(2000);
  }

  const items = await page.evaluate((selector) => {
    const links = Array.from(document.querySelectorAll(selector));
    const seen = new Set<string>();

    return links
      .map(a => ({
        title: (a as HTMLElement).textContent?.trim().replace(/\s+/g, ' ') || '',
        url: (a as HTMLAnchorElement).href || '',
      }))
      .filter(item => {
        if (item.title.length < 8 || item.title.length > 200) return false;
        if (!item.url || item.url.includes('#') || item.url.includes('javascript:')) return false;
        if (seen.has(item.title)) return false;
        seen.add(item.title);
        return true;
      })
      .slice(0, 5);
  }, source.selector);

  return items.map(item => ({
    ...item,
    published_at: new Date().toISOString(),
    summary_en: '',
    source: source.name,
  }));
}

export async function collect(): Promise<CollectorResult> {
  const result: CollectorResult = { section: 'trade', data: [] };
  let browser: Browser | null = null;

  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.setExtraHTTPHeaders({
      'User-Agent': 'Logisight/1.0 (logisight.mtlship.com; news-bot)',
      'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8',
    });

    for (const source of SOURCES) {
      try {
        const items = await rateLimited(source.url, () => scrapePage(page, source));

        for (const item of items) {
          result.data.push({
            data_type: 'news',
            data_key: `${source.name}_${Date.now()}`,
            data_value: { ...item, section: source.section, language: source.language },
            source: source.name,
            source_url: source.url,
            is_complete: true,
          });
        }

        console.log(`✅ ${source.name}: ${items.length}건`);
      } catch (error) {
        console.error(`❌ ${source.name}:`, (error as Error).message);
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
  } finally {
    if (browser) await browser.close();
  }

  return result;
}
