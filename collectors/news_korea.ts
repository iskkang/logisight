// collectors/news_korea.ts
// 한국 물류 뉴스 수집기 — RSS + fetch 기반 (Playwright 미사용)
// 대상: 카고뉴스, 쉬핑뉴스넷, 쉬핑데일리, 카고프레스, KL뉴스, 마리타임프레스, 코리아쉬핑가제트

import { rateLimited } from './utils/rate_limiter';
import { snapshotWriter } from './utils/snapshot_writer';
import type { CollectorResult, NewsItem } from './types';

const SOURCES = [
  {
    name: '카고뉴스',
    url: 'https://www.cargonews.co.kr/',
    rss: ['https://www.cargonews.co.kr/rss/allArticle.xml'],
    articlePattern: null,   // RSS 사용 — HTML 경로로 내려오지 않는다
    section: 'shipping' as const,
  },
  {
    name: '쉬핑뉴스넷',
    url: 'https://www.shippingnewsnet.com/',
    // /feed·/rss.xml 후보는 전부 404 였다. 사이트가 안내하는 실제 경로는
    // /rssIndex.html 에 적혀 있고 allArticle.xml 이다(2026-10-06 확인, 50건).
    rss: ['https://www.shippingnewsnet.com/rss/allArticle.xml'],
    articlePattern: null,   // RSS 사용 — HTML 경로로 내려오지 않는다
    section: 'shipping' as const,
  },
  {
    name: '쉬핑데일리',
    url: 'https://www.shippingdaily.co.kr/index.php',
    // RSS 가 없다. 사이트가 PHP 게시판(/bbs/board.php)이고 피드 경로가 전부 404,
    // robots.txt 에도 피드 안내가 없다(2026-10-06 확인). 죽은 후보를 계속 두면
    // 매 실행 실패 3건이 찍히기만 하므로, 카고프레스·KL뉴스와 같은 HTML 경로로 돌린다.
    rss: null,
    articlePattern: /board_view\.php\?.*bbs_number=\d+/,
    section: 'shipping' as const,
  },
  {
    name: '카고프레스',
    url: 'https://www.cargopress.co.kr/korean/news.php',
    rss: null,
    articlePattern: /news_view\.php\?nd=\d+/,
    section: 'shipping' as const,
  },
  {
    name: 'KL뉴스',
    url: 'https://www.klnews.co.kr/',
    rss: null,
    articlePattern: /(articleView|view)\.html\?idxno=\d+/,
    section: 'shipping' as const,
  },
  {
    name: '마리타임프레스',
    url: 'http://www.maritimepress.co.kr/',
    rss: null,
    articlePattern: /view\.html\?idxno=\d+/,
    section: 'shipping' as const,
  },
  // 코리아쉬핑가제트 (한러·한중 항로 특화)
  {
    name: '코리아쉬핑가제트',
    url: 'https://www.ksg.co.kr/news/main_news.jsp',
    // RSS 가 없다. 홈페이지 HTML 에 피드 링크가 없고 흔한 경로(/rss/*, /feed,
    // /rss.php)와 sitemap.xml·robots.txt 까지 전부 404 다(2026-10-06 확인).
    rss: null,
    articlePattern: /main_newsView\.jsp\?pNum=\d+/,
    section: 'shipping' as const,
  },
];

const FETCH_HEADERS = {
  'User-Agent': 'Logisight/1.0 (logisight.mtlship.com; news-bot)',
  'Accept-Language': 'ko-KR,ko;q=0.9',
};

async function parseRss(rssUrl: string, sourceName: string): Promise<NewsItem[]> {
  const res = await fetch(rssUrl, {
    headers: FETCH_HEADERS,
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();

  const items: NewsItem[] = [];
  for (const m of text.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const b = m[1];
    const title = (
      b.match(/<title><!\[CDATA\[(.*?)\]\]>/)?.[1] ||
      b.match(/<title>(.*?)<\/title>/)?.[1] ||
      ''
    ).trim();
    const link = (b.match(/<link>(.*?)<\/link>/)?.[1] || '').trim();
    const pubDate = b.match(/<pubDate>(.*?)<\/pubDate>/)?.[1] || '';

    if (title && link) {
      items.push({
        title,
        url: link,
        published_at: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString(),
        summary_en: '',
        source: sourceName,
      });
    }
    if (items.length >= 5) break;
  }
  return items;
}

async function tryRssFallbacks(urls: string[], sourceName: string): Promise<NewsItem[]> {
  for (const url of urls) {
    try {
      const items = await parseRss(url, sourceName);
      if (items.length > 0) return items;
    } catch {
      // try next
    }
  }
  throw new Error(`RSS 모든 후보 실패: ${urls.join(', ')}`);
}

// 선언 문자셋대로 읽는다 ★
// res.text() 는 UTF-8 을 가정한다. 쉬핑데일리는 EUC-KR 이라 제목이 통째로 깨진
// 채로 수집됐다("쉬핑데일리" → "���ε��ϸ�"). 그 쓰레기가 maritime_news 를 거쳐
// 월간 리포트 아이템 풀까지 들어간다. Content-Type 헤더를 먼저 보고, 없으면
// 본문의 <meta charset> 을 본다. 모르는 인코딩이면 UTF-8 로 되돌린다.
function decodeBody(buf: ArrayBuffer, contentType: string | null): string {
  const head = new TextDecoder('utf-8').decode(buf.slice(0, 2048));
  const declared =
    (contentType || '').match(/charset=([\w-]+)/i)?.[1] ||
    head.match(/<meta[^>]+charset=["']?([\w-]+)/i)?.[1] ||
    'utf-8';
  try {
    return new TextDecoder(declared.toLowerCase()).decode(buf);
  } catch {
    return new TextDecoder('utf-8').decode(buf);
  }
}

async function fetchAndParseHtml(
  pageUrl: string,
  sourceName: string,
  articlePattern: RegExp | null = null,
): Promise<NewsItem[]> {
  const res = await fetch(pageUrl, {
    headers: FETCH_HEADERS,
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = decodeBody(await res.arrayBuffer(), res.headers.get('content-type'));

  // base 는 더 쓰지 않는다 —— new URL(href, pageUrl) 이 상대 주소를 전부 해석한다.
  const items: NewsItem[] = [];
  const seen = new Set<string>();

  for (const m of html.matchAll(/<a[^>]+href="([^"]+)"[^>]*>([^<]{8,120})<\/a>/g)) {
    let href = m[1].trim();
    const title = m[2].trim().replace(/\s+/g, ' ');

    if (!href || href.startsWith('javascript') || href.startsWith('#') || href.startsWith('mailto')) continue;
    if (seen.has(title)) continue;

    // 기사 링크만 고른다 ★
    // 앵커를 전부 줍던 때는 메뉴가 기사로 들어왔다 —— 쉬핑데일리는 "회원가입·
    // 사이트맵·탑뉴스", 코리아쉬핑가제트는 "English news·용어사전·스케줄" 5건이
    // 전부였고 실제 기사는 0건이었다. 사이트마다 상세 페이지 주소가 뚜렷하므로
    // (main_newsView.jsp?pNum= / news_view.php?nd= / view.html?idxno= /
    // board_view.php?...bbs_number=) 그 모양을 가진 링크만 남긴다.
    if (articlePattern && !articlePattern.test(href)) continue;

    // 상대 주소는 전부 표준 해석에 맡긴다.
    // 직접 붙이던 때는 './' 와 '/' 만 처리해서, 카고프레스처럼 접두사 없는
    // 'news_view.php?nd=7541' 형태가 http 로 시작하지 않는다는 이유로 전부 버려졌다
    // (그 소스만 0건이었다).
    try {
      href = new URL(href, pageUrl).href;
    } catch {
      continue;
    }
    if (!href.startsWith('http')) continue;

    seen.add(title);
    items.push({
      title,
      url: href,
      published_at: new Date().toISOString(),
      summary_en: '',
      source: sourceName,
    });

    if (items.length >= 5) break;
  }
  return items;
}

export async function collect(): Promise<CollectorResult> {
  const result: CollectorResult = { section: 'shipping', data: [] };

  for (const source of SOURCES) {
    try {
      const items = source.rss
        ? await rateLimited(source.url, () => tryRssFallbacks(source.rss!, source.name))
        : await rateLimited(source.url, () => fetchAndParseHtml(source.url, source.name, source.articlePattern ?? null));

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

  return result;
}

if (require.main === module) {
  collect().then(r => {
    const success = r.data.filter(d => d.is_complete).length;
    console.log(`\n총 ${r.data.length}건 중 ${success}건 수집 완료`);
    return snapshotWriter(r);
  }).catch(console.error);
}
