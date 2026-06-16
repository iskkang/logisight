export type NewsSection = 'shipping' | 'air' | 'rail' | 'trade' | 'logistics';

export type NewsSource = {
  name: string;
  url: string;
  kind: 'rss' | 'html';
  section: NewsSection;
  language: 'en' | 'ko';
  selector?: string;
  monthly?: boolean;
};

export const CATEGORY_BY_SECTION: Record<NewsSection | 'ocean' | 'policy', string> = {
  shipping: '해상',
  ocean: '해상',
  air: '항공',
  rail: '철도',
  trade: '무역',
  policy: '무역',
  logistics: '물류',
};

/**
 * Shared source registry for daily web news and monthly analysis.
 * Keep source URLs here instead of duplicating them across collectors.
 */
export const NEWS_SOURCES: NewsSource[] = [
  { name: 'The Loadstar', url: 'https://theloadstar.com/feed/', kind: 'rss', section: 'shipping', language: 'en' },
  { name: 'Splash247', url: 'https://splash247.com/feed/', kind: 'rss', section: 'shipping', language: 'en' },
  { name: 'FreightWaves', url: 'https://www.freightwaves.com/feed', kind: 'rss', section: 'logistics', language: 'en' },

  { name: 'IATA Pressroom', url: 'https://www.iata.org/en/pressroom/', kind: 'html', section: 'air', language: 'en', selector: 'article a, h2 a, h3 a' },
  { name: 'Asia Cargo News', url: 'https://www.asiacargonews.com/', kind: 'html', section: 'air', language: 'en', selector: 'a[href*="/en/news/detail"]' },
  { name: 'Air Freight News', url: 'https://airfreight.news/articles/category/air-freighters', kind: 'html', section: 'air', language: 'en', selector: 'a[href*="/articles/full/"]' },
  { name: 'WorldACD', url: 'https://www.worldacd.com/feed/', kind: 'rss', section: 'air', language: 'en', monthly: true },
  { name: 'Air Cargo News', url: 'https://www.aircargonews.net/feed/', kind: 'rss', section: 'air', language: 'en', monthly: true },
  { name: 'Air Cargo Week', url: 'https://aircargoweek.com/feed/', kind: 'rss', section: 'air', language: 'en' },
  { name: 'STAT Times', url: 'https://www.stattimes.com/feed', kind: 'rss', section: 'air', language: 'en' },
  { name: 'Cargo Forwarder', url: 'https://www.cargoforwarder.eu/feed/', kind: 'rss', section: 'air', language: 'en' },
  { name: 'Air Cargo Week Market Data', url: 'https://www.aircargoweek.com/market-data/', kind: 'html', section: 'air', language: 'en', selector: 'article a, h2 a, h3 a', monthly: true },

  { name: 'RailFreight BeltAndRoad', url: 'https://www.railfreight.com/category/beltandroad/feed/', kind: 'rss', section: 'rail', language: 'en', monthly: true },
  { name: 'RailFreight Russia', url: 'https://www.railfreight.com/tag/russia/feed/', kind: 'rss', section: 'rail', language: 'en', monthly: true },
  { name: 'SeaNews EN', url: 'https://seanews.ru/en/feed/', kind: 'rss', section: 'rail', language: 'en', monthly: true },
  { name: 'Transport Corridors', url: 'https://www.transportcorridors.com/category/regions/central-asia', kind: 'html', section: 'rail', language: 'en', selector: 'article a, .post-title a, h2 a', monthly: true },
  { name: 'Global Times BRI', url: 'https://www.globaltimes.cn/rss/outbrain.xml', kind: 'rss', section: 'rail', language: 'en', monthly: true },
  { name: 'Landbridge', url: 'http://www.landbridge.com/yaowen/', kind: 'html', section: 'rail', language: 'en', selector: 'article a, h2 a, h3 a, .title a', monthly: true },

  { name: 'Supply Chain Dive', url: 'https://www.supplychaindive.com/feeds/news/', kind: 'rss', section: 'trade', language: 'en', monthly: true },
  { name: 'USTR', url: 'https://ustr.gov/rss.xml', kind: 'rss', section: 'trade', language: 'en', monthly: true },
  { name: 'US CBP Trade News', url: 'https://www.cbp.gov/rss.xml', kind: 'rss', section: 'trade', language: 'en', monthly: true },
  { name: 'EU Trade Pressroom', url: 'https://ec.europa.eu/commission/presscorner/api/rss?keyword=trade&language=en', kind: 'rss', section: 'trade', language: 'en', monthly: true },
  { name: 'KITA', url: 'https://www.kita.net/shippers/board/newsList.do', kind: 'html', section: 'trade', language: 'ko', selector: '.board-list a, td a, .title a', monthly: true },
  { name: 'NLIC', url: 'https://www.nlic.go.kr/nlic/newsArticleList.action', kind: 'html', section: 'trade', language: 'ko', selector: '.list a, td a, .title a, .subject a', monthly: true },
  { name: 'KOTRA', url: 'https://dream.kotra.or.kr/kotranews/cms/com/index.do?MENU_ID=70', kind: 'html', section: 'trade', language: 'ko', selector: '.list-title a, .tit a, td a', monthly: true },
];

export function sourcesFor(
  sections: NewsSection[],
  kind?: NewsSource['kind'],
): NewsSource[] {
  return NEWS_SOURCES.filter(
    (source) => sections.includes(source.section) && (!kind || source.kind === kind),
  );
}
