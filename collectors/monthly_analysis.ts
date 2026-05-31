// collectors/monthly_analysis.ts
// 월간 분석 소스 수집기 — 기업 업데이트·심층 분석 (daily 파이프라인과 분리)
// data_type: 'monthly_source' — curate-rail/ocean.js가 건드리지 않음
// 실행: npm run collect:monthly  (매월 2일 04:00 KST GitHub Actions)
//
// 운임 지수 값(WCI/FBX/SCFI/KCCI/CCFI/BDI)은 shipping_indices.ts 책임 — 여기서 다루지 않음
// JS 렌더링/차단 소스(Maersk·DHL·Xeneta·一带一路)는 별도 carrier_reports_pw.ts (Playwright) 태스크로 분리

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
  category: 'carrier_update' | 'deep_analysis';
  urlPattern?: RegExp;  // html 전용: 기사 URL 경로 패턴 (메뉴·푸터 제거용)
}

const MONTHLY_SOURCES: MonthlySource[] = [
  // ── deep_analysis: RSS (검증 완료, 요약 포함 40건) ──
  {
    name: 'JOC',
    url: 'https://feeds.feedburner.com/joc/aajm',
    type: 'rss',
    section: 'shipping',
    category: 'deep_analysis',
  },

  // ── carrier_update: SSR HTML + urlPattern (메뉴·푸터 제거) ──
  {
    name: 'Freightos Weekly Update',
    url: 'https://www.freightos.com/freight-industry-updates/',
    type: 'html',
    section: 'shipping',
    category: 'carrier_update',
    // 슬래시 뒤 슬래그가 반드시 있어야 함 — 카테고리 페이지(/weekly-freight-updates/) 제외
    urlPattern: /\/freight-industry-updates\/(weekly-freight-updates|market-updates)\/.+/,
  },
  {
    name: 'Flexport Update',
    url: 'https://www.flexport.com/global-logistics-update/',
    type: 'html',
    section: 'shipping',
    category: 'carrier_update',
    // 기사 slug는 항상 "월명-일-연도" 시작 (예: /global-logistics-update/may-28-2026-...)
    // 월명 화이트리스트로 좁혀 customs-suite 등 잡링크 차단
    // Maersk: robots 차단(ToS 위반 소지), DHL: 최신 콘텐츠 JS 지연로드 → 두 소스 모두 자동수집 제외,
    //         월간 리포트 작성 시 운영자가 수동 확인 권장
    urlPattern: /\/global-logistics-update\/(january|february|march|april|may|june|july|august|september|october|november|december)-\d{1,2}-\d{4}/i,
  },
];

// ocean_news.ts 원본을 건드리지 않기 위해 monthly 전용 파서를 여기에 둔다.

async function parseRss(src: MonthlySource): Promise<NewsItem[]> {
  const res = await fetch(src.url, { headers: BOT_HEADERS, signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  const items: NewsItem[] = [];

  for (const m of text.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const b = m[1];
    const title = (b.match(/<title><!\[CDATA\[([\s\S]*?)\]\]>/)?.[1] || b.match(/<title>([\s\S]*?)<\/title>/)?.[1] || '').trim();
    const link  = (b.match(/<link>([\s\S]*?)<\/link>/)?.[1] || '').trim();
    const desc  = (b.match(/<description><!\[CDATA\[([\s\S]*?)\]\]>/)?.[1] || b.match(/<description>([\s\S]*?)<\/description>/)?.[1] || '').trim();
    const pub   = b.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1] || '';
    if (!title || !link) continue;
    items.push({
      title,
      url: link,
      published_at: pub ? new Date(pub).toISOString() : new Date().toISOString(),
      summary_en: desc.replace(/<[^>]+>/g, '').slice(0, 400),
      source: src.name,
    });
    if (items.length >= 10) break;  // 월간 분석은 10건
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

  // Primary pass: anchors with visible direct text (works for Freightos etc.)
  for (const m of html.matchAll(/<a[^>]+href="([^"]+)"[^>]*>([^<]{10,160})<\/a>/g)) {
    let href = m[1].trim();
    const title = m[2].trim().replace(/\s+/g, ' ');
    if (!href || href.startsWith('javascript') || href.startsWith('#') || href.startsWith('mailto')) continue;
    if (href.startsWith('/')) href = `${base}${href}`;
    if (!href.startsWith('http')) continue;
    // urlPattern이 있으면 기사 경로만 채택 — 메뉴·푸터 링크 차단
    if (src.urlPattern && !src.urlPattern.test(href)) continue;
    if (seen.has(href)) continue;
    seen.add(href);
    items.push({ title, url: href, published_at: new Date().toISOString(), summary_en: '', source: src.name });
    if (items.length >= 5) break;
  }

  // Fallback pass: href-only extraction for urlPattern sources whose anchors
  // contain child elements (JS-framework pages like Flexport/Gatsby).
  // Title is derived from the URL slug by stripping the date prefix.
  if (src.urlPattern && items.length < 5) {
    for (const m of html.matchAll(/<a\b[^>]+href="([^"]+)"/g)) {
      let href = m[1].trim();
      if (!href || href.startsWith('javascript') || href.startsWith('#') || href.startsWith('mailto')) continue;
      if (href.startsWith('/')) href = `${base}${href}`;
      if (!href.startsWith('http')) continue;
      if (!src.urlPattern.test(href)) continue;
      if (seen.has(href)) continue;
      seen.add(href);
      const slug = href.replace(/\/$/, '').split('/').pop() ?? '';
      // strip leading "month-day-year-" date prefix from slug
      const titleRaw = slug.replace(/^[a-z]+-\d{1,2}-\d{4}-?/, '').replace(/-/g, ' ').trim();
      if (!titleRaw) continue;
      const title = titleRaw.charAt(0).toUpperCase() + titleRaw.slice(1);
      items.push({ title, url: href, published_at: new Date().toISOString(), summary_en: '', source: src.name });
      if (items.length >= 5) break;
    }
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
