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
  // ── 뺀 소스 ─────────────────────────────────────────────────────────
  // 쉬핑데일리(shippingdaily.co.kr)
  //   RSS 없음. /news.php·/top_news.php 는 index.php 로 JS 리다이렉트만 돌려주고,
  //   index.php 에 평문으로 노출되는 글은 전부 채용공고다("KSF선박금융 경력사원 모집",
  //   "팬오션 사무직원 채용"…). 기사 목록(bbs/board.php)은 bbs_number 가 자바스크립트
  //   함수 안에만 있어 정적 파싱으로 닿지 않는다. 되살리려면 news_browser.ts 쪽
  //   Playwright 경로가 필요하다.
  //
  // 마리타임프레스(maritimepress.co.kr)
  //   첫 화면에서 기사 후보가 2건뿐이고 그마저 2017~2018년 공지다. 최신 기사는
  //   존재하나(2026-10-06) 같은 페이지의 다른 마크업에 있어 현재 파서로는 닿지 않는다.
  //
  // 둘 다 매 실행 5건씩 쓰레기를 스냅샷에 넣고 있었다. 그 스냅샷은 월간 리포트
  // 아이템 풀과 기사 브리프의 재료다 —— 안 들어오는 편이 낫다.
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

  // 앵커를 하나씩 독립적으로 읽는다 ★
  // <a ...>(.*?)</a> 한 덩어리로 매칭하면, 기사 링크가 아닌 앵커가 먼저 걸려 그 뒤의
  // 기사 앵커까지 통째로 삼킨다. 마리타임프레스에서 idxno 링크가 140개인데 25개만
  // 보였던 이유다 —— 그 25개가 전부 인사·부고·결혼 공지라 기사가 한 건도 안 남았다.
  // 여는 태그만 훑고 가장 가까운 </a> 까지를 제목으로 본다. 그러면 앵커끼리 서로를
  // 삼키지 않는다(같은 페이지에서 기사 후보 2건 → 55건).
  //
  // 안쪽 태그는 벗긴다. <a><span>제목</span></a> 꼴이 흔하다.
  for (const m of html.matchAll(/<a[^>]*href="([^"]+)"[^>]*>/g)) {
    let href = m[1].trim();
    const bodyStart = (m.index ?? 0) + m[0].length;
    const bodyEnd = html.indexOf('</a>', bodyStart);
    if (bodyEnd < 0 || bodyEnd - bodyStart > 400) continue;
    const title = html.slice(bodyStart, bodyEnd)
      .replace(/<[^>]*>/g, ' ')
      // 엔티티를 풀어 둔다. 풀지 않으면 제목에 "&lt;아도라매직시티&gt;" 가 그대로 박힌다.
      .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
      .trim().replace(/\s+/g, ' ');
    if (title.length < 8 || title.length > 120) continue;

    if (!href || href.startsWith('javascript') || href.startsWith('#') || href.startsWith('mailto')) continue;
    if (seen.has(title)) continue;

    if (articlePattern && !articlePattern.test(href)) continue;

    // 공지·행사 글은 기사가 아니다 ★
    // 마리타임프레스 첫 화면은 공지가 위쪽에 깔려 있어서, 상위 5건만 집던 때는
    // "(10/21)한국해사포럼 공개포럼개최", "교육/2017 하반기 …" 같은 것만 들어오고
    // 정작 "HMM 톱10중 용선비중 가장 낮아", "8월 국내 항만 '컨'물동량 급증세" 같은
    // 기사는 잘려 나갔다(103건 중 공지 27건이 앞자리를 차지한다).
    // 제목 앞머리가 날짜 괄호이거나 분류 접두사면 거른다.
    if (/^\(\d{1,2}\/\d{1,2}\)/.test(title)) continue;
    if (/^(교육|알림|공지|이전|채용|모집|안내)\s*\//.test(title)) continue;

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

    // 주소로도 중복을 막는다 ★
    // 같은 글이 "잘린 제목…" 과 "전체 제목" 두 벌로 걸리는 목록이 있다(코리아쉬핑가제트의
    // "여수항, 초대형 크루즈 <아도라매직…" / "여수항, 초대형 크루즈 <아도라매직시티> 올…").
    // 제목만 보면 서로 달라 보여 둘 다 들어왔다. 주소 해석이 끝난 뒤에 걸러야 키가 맞는다.
    if (seen.has(href)) continue;

    seen.add(title);
    seen.add(href);
    items.push({
      title,
      url: href,
      published_at: new Date().toISOString(),
      summary_en: '',
      source: sourceName,
    });
  }

  // 문서 순서가 아니라 최신순으로 5건을 고른다 ★
  // 예전에는 매칭되는 앵커를 앞에서부터 5건 집고 끊었다. 그런데 이 사이트들은 공지를
  // 페이지 위쪽에 고정해 둔다 —— 마리타임프레스는 103건 중 27건이 공지이고 그게 전부
  // 앞자리라, 정작 "HMM 톱10중 용선비중 가장 낮아" 같은 기사는 잘려 나갔다.
  // 네 소스 모두 상세 주소에 숫자 ID 가 있고(pNum·nd·idxno·bbs_number) 큰 값일수록
  // 새 글이다. 그 값으로 내림차순 정렬해 위에서 5건을 가져온다.
  const idOf = (u: string) => {
    const m = u.match(/(?:pNum|nd|idxno|bbs_number)=(\d+)/);
    return m ? Number(m[1]) : -1;
  };
  return items.sort((a, b) => idOf(b.url) - idOf(a.url)).slice(0, 5);
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
