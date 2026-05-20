// workers/collectors/news_korea.ts
// 한국 물류 뉴스 수집기
// 대상: 카고뉴스, 카고프레스, 쉬핑뉴스넷, 쉬핑데일리, KL뉴스, 마리타임프레스

import { chromium, type Browser, type Page } from 'playwright';
import { rateLimited } from './utils/rate_limiter';
import type { CollectorResult, NewsItem } from './types';

const SOURCES = [
  {
    name: '카고뉴스',
    url: 'https://www.cargonews.co.kr/',
    rss: 'https://www.cargonews.co.kr/rss/allArticle.xml',
    section: 'shipping' as const,
  },
  {
    name: '카고프레스',
    url: 'https://www.cargopress.co.kr/korean/news.php',
    rss: null, // RSS 없음 — 스크래핑
    section: 'shipping' as const,
  },
  {
    name: '쉬핑뉴스넷',
    url: 'https://www.shippingnewsnet.com/',
    rss: null,
    section: 'shipping' as const,
  },
  {
    name: '쉬핑데일리',
    url: 'https://www.shippingdaily.co.kr/index.php',
    rss: null,
    section: 'shipping' as const,
  },
  {
    name: 'KL뉴스',
    url: 'https://www.klnews.co.kr/',
    rss: null,
    section: 'shipping' as const,
  },
  {
    name: '마리타임프레스',
    url: 'http://www.maritimepress.co.kr/',
    rss: null,
    section: 'shipping' as const,
  },
];

async function scrapeNewsPage(page: Page, source: typeof SOURCES[0]): Promise<NewsItem[]> {
  await page.goto(source.url, {
    waitUntil: 'domcontentloaded',
    timeout: 20000,
  });

  // 일반적인 뉴스 링크 패턴 추출
  const items = await page.evaluate(() => {
    const links = Array.from(document.querySelectorAll('a'));
    const news: Array<{ title: string; url: string }> = [];

    for (const link of links) {
      const text = link.textContent?.trim() || '';
      const href = link.href || '';

      // 뉴스 기사 링크 필터 (최소 10자 제목, 외부 링크 제외)
      if (
        text.length > 10
        && text.length < 100
        && href.includes(window.location.hostname)
        && !href.includes('javascript')
        && !href.includes('#')
      ) {
        news.push({ title: text, url: href });
      }
    }

    // 중복 제거
    const seen = new Set<string>();
    return news.filter(item => {
      if (seen.has(item.title)) return false;
      seen.add(item.title);
      return true;
    }).slice(0, 5); // 최신 5건
  });

  return items.map(item => ({
    title: item.title,
    url: item.url,
    published_at: new Date().toISOString(),
    summary_en: '',
    source: source.name,
  }));
}

async function parseRss(url: string): Promise<NewsItem[]> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Logisight/1.0 (logisight.mtlship.com; news-bot)' },
  });
  const text = await res.text();
  const items: NewsItem[] = [];
  const matches = text.matchAll(/<item>([\s\S]*?)<\/item>/g);

  for (const m of matches) {
    const b = m[1];
    const title = (b.match(/<title><!\[CDATA\[(.*?)\]\]>/)?.[1] || b.match(/<title>(.*?)<\/title>/)?.[1] || '').trim();
    const link = (b.match(/<link>(.*?)<\/link>/)?.[1] || '').trim();
    const pubDate = b.match(/<pubDate>(.*?)<\/pubDate>/)?.[1] || '';
    if (title && link) {
      items.push({ title, url: link, published_at: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString(), summary_en: '', source: '' });
    }
    if (items.length >= 5) break;
  }
  return items;
}

export async function collect(): Promise<CollectorResult> {
  const result: CollectorResult = { section: 'shipping', data: [] };
  let browser: Browser | null = null;

  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.setExtraHTTPHeaders({
      'User-Agent': 'Logisight/1.0 (logisight.mtlship.com; news-bot)',
      'Accept-Language': 'ko-KR,ko;q=0.9',
    });

    for (const source of SOURCES) {
      try {
        let items: NewsItem[];

        if (source.rss) {
          items = await rateLimited(source.rss, () => parseRss(source.rss!));
        } else {
          items = await rateLimited(source.url, () => scrapeNewsPage(page, source));
        }

        for (const item of items) {
          result.data.push({
            data_type: 'news',
            data_key: `${source.name}_${Date.now()}`,
            data_value: { ...item, source: source.name, section: source.section, language: 'ko' },
            source: source.name,
            source_url: source.url,
            is_complete: true,
          });
        }

        console.log(`✅ ${source.name}: ${items.length}건 수집`);
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
  } finally {
    if (browser) await browser.close();
  }

  return result;
}
