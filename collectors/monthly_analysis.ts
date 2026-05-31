// collectors/monthly_analysis.ts
// 월간 분석 소스 수집기 — 운임지수·기업 월간업데이트·심층분석 (daily 파이프라인과 분리)
// data_type: 'monthly_source' 로 저장 — curate-rail/ocean.js가 건드리지 않음
// 실행: npm run collect:monthly  (매월 2일 04:00 KST GitHub Actions)

// TODO: oneksa.kr 엑셀 다운로드는 collectors/utils/xlsx_parser.ts 활용해 별도 PR에서 추가

import { rateLimited } from './utils/rate_limiter';
import { snapshotWriter } from './utils/snapshot_writer';
import type { CollectorResult, NewsItem } from './types';

const BOT_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Accept': 'application/rss+xml, application/xml, text/xml, */*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

interface MonthlySource {
  name: string;
  url: string;
  type: 'rss' | 'html';
  section: 'shipping' | 'rail' | 'trade';
  category: 'freight_index' | 'carrier_update' | 'deep_analysis';
}

const MONTHLY_SOURCES: MonthlySource[] = [
  // ── 운임 지수 (freight_index) ──
  { name: 'Freightos FBX',        url: 'https://www.freightos.com/freight-industry-updates/', type: 'html', section: 'shipping', category: 'freight_index' },
  { name: 'Drewry WCI',           url: 'https://www.drewry.co.uk/supply-chain-advisors/supply-chain-expertise/world-container-index-assessed-by-drewry', type: 'html', section: 'shipping', category: 'freight_index' },
  { name: 'Xeneta XSI',           url: 'https://www.xeneta.com/news',                          type: 'html', section: 'shipping', category: 'freight_index' },
  { name: 'KOBC KCCI',            url: 'https://www.kobc.or.kr/ebz/shippinginfo/kcci/gridList.do?mId=0304000000', type: 'html', section: 'shipping', category: 'freight_index' },

  // ── 기업 월간 Market Update (carrier_update) ──
  // 주의: Maersk 캐시가 오래될 수 있음 (확인: 2024-07 기준), DHL도 신선도 점검 필요
  { name: 'Maersk Market Update', url: 'https://www.maersk.com/news/category/news',             type: 'html', section: 'shipping', category: 'carrier_update' },
  { name: 'DHL Market Update',    url: 'https://lot.dhl.com/categories/resources/',             type: 'html', section: 'shipping', category: 'carrier_update' },
  { name: 'Flexport Update',      url: 'https://www.flexport.com/global-logistics-update/',     type: 'html', section: 'shipping', category: 'carrier_update' },

  // ── 심층 분석 (deep_analysis) ──
  // Sea-Intelligence: shipshipship.uk 애그리게이터 경유 (직접 접근 시 유료 차단)
  { name: 'Sea-Intelligence',     url: 'https://www.shipshipship.uk/publications/362/sea-intelligence', type: 'html', section: 'shipping', category: 'deep_analysis' },
  { name: 'JOC Container',        url: 'https://www.joc.com/maritime/container-shipping-news',  type: 'html', section: 'shipping', category: 'deep_analysis' },
  { name: '一带一路 데이터',        url: 'https://www.yidaiyilu.gov.cn/dataChart',               type: 'html', section: 'rail',     category: 'deep_analysis' },
];

async function parseRss(src: MonthlySource): Promise<NewsItem[]> {
  const res = await fetch(src.url, { headers: BOT_HEADERS, signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  const items: NewsItem[] = [];
  for (const m of text.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const b = m[1];
    const title   = (b.match(/<title><!\[CDATA\[(.*?)\]\]>/)?.[1] || b.match(/<title>(.*?)<\/title>/)?.[1] || '').trim();
    const link    = (b.match(/<link>(.*?)<\/link>/)?.[1] || '').trim();
    const pubDate = b.match(/<pubDate>(.*?)<\/pubDate>/)?.[1] || '';
    if (!title || !link) continue;
    items.push({ title, url: link, published_at: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString(), summary_en: '', source: src.name });
    if (items.length >= 5) break;
  }
  return items;
}

async function fetchHtmlLinks(src: MonthlySource): Promise<NewsItem[]> {
  const res = await fetch(src.url, { headers: BOT_HEADERS, signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  const base = new URL(src.url).origin;
  const items: NewsItem[] = [];
  const seen = new Set<string>();
  for (const m of html.matchAll(/<a[^>]+href="([^"]+)"[^>]*>([^<]{10,120})<\/a>/g)) {
    let href = m[1].trim();
    const title = m[2].trim().replace(/\s+/g, ' ');
    if (!href || href.startsWith('javascript') || href.startsWith('#') || href.startsWith('mailto')) continue;
    if (seen.has(title)) continue;
    if (href.startsWith('/')) href = `${base}${href}`;
    if (!href.startsWith('http')) continue;
    seen.add(title);
    items.push({ title, url: href, published_at: new Date().toISOString(), summary_en: '', source: src.name });
    if (items.length >= 5) break;
  }
  return items;
}

export async function collect(): Promise<CollectorResult> {
  const result: CollectorResult = { section: 'shipping', data: [] };

  const settled = await Promise.allSettled(
    MONTHLY_SOURCES.map(src => rateLimited(src.url, () => src.type === 'rss' ? parseRss(src) : fetchHtmlLinks(src)))
  );

  for (let i = 0; i < MONTHLY_SOURCES.length; i++) {
    const src = MONTHLY_SOURCES[i];
    const res = settled[i];
    if (res.status === 'rejected') {
      console.log(`⚠️ ${src.name} 실패: ${(res.reason as Error).message}`);
      result.data.push({
        data_type: 'monthly_source',
        data_key: `MONTHLY_${src.category}_error_${src.name}`,
        data_value: {},
        source: src.name, source_url: src.url, is_complete: false,
        error_message: (res.reason as Error).message,
      });
      continue;
    }
    for (const item of res.value) {
      result.data.push({
        data_type: 'monthly_source',
        data_key: `MONTHLY_${src.category}_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        data_value: { ...item, section: src.section, language: 'en', category: src.category },
        source: src.name, source_url: src.url, is_complete: true,
      });
    }
    console.log(`✅ ${src.name}: ${res.value.length}건`);
  }

  const success = result.data.filter(d => d.is_complete).length;
  console.log(`\n✅ monthly_analysis: ${success}건 수집 완료`);
  return result;
}

if (require.main === module) {
  collect().then(r => snapshotWriter(r)).catch(console.error);
}
