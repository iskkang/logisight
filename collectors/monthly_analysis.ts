// collectors/monthly_analysis.ts
// 월간 분석 소스 수집기 — 기업 업데이트·심층 분석 (daily 파이프라인과 분리)
// data_type: 'monthly_source' — curate-rail/ocean.js가 건드리지 않음
// 실행: npm run collect:monthly  (매월 2일 04:00 KST GitHub Actions)
//
// 운임 지수 값(WCI/FBX/SCFI/KCCI/CCFI/BDI)은 shipping_indices.ts 책임 — 여기서 다루지 않음
// JS 렌더링/차단 소스(Maersk·DHL)는 별도 carrier_reports_pw.ts (Playwright) 태스크로 분리

import { rateLimited } from './utils/rate_limiter';
import { snapshotWriter } from './utils/snapshot_writer';
import { fetchArticleBody } from './utils/article_body';
import type { CollectorResult, NewsItem } from './types';
import { NEWS_SOURCES } from './news_sources';

const BOT_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Accept': 'application/rss+xml, application/xml, text/xml, */*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

const BAD_TITLE = /\| RailFreight\.com|^Asia-Europe$|^Belt and Road$|^Russia$|^RailFreight$|^SeaNews$|^Global Times$/i;

interface MonthlySource {
  name: string;
  url: string;
  type: 'rss' | 'html' | 'linerlytica';
  section: 'shipping' | 'air' | 'rail' | 'trade';
  category: 'carrier_update' | 'deep_analysis' | 'lane_causal';
  urlPattern?: RegExp;   // html 전용: 기사 URL 경로 패턴 (메뉴·푸터 제거용)
  topicFilter?: RegExp;  // rss 전용: 이 패턴에 매칭되는 항목만 보관 (일반 소스 노이즈 제거)
}

const MONTHLY_SOURCES_BASE: MonthlySource[] = [
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

  // ── lane_causal: 항로별 등락 원인 코멘트 소스 ──
  // Linerlytica: SSR HTML, /tag/marketpulse/ 에 최근 ~10주 Market Pulse 무료 인트로 포함
  // 인트로에 항로별 원인 서술: "Asia-Europe rates dragged down by capacity pressure from new 24,000 TEU ships" 등
  {
    name: 'Linerlytica Market Pulse',
    url: 'https://www.linerlytica.com/tag/marketpulse/',
    type: 'linerlytica',
    section: 'shipping',
    category: 'lane_causal',
  },

  // gCaptain: RSS, 종합 해운·해사 뉴스 — 운임 관련 기사가 deep_analysis에 기여
  // topicFilter: 군사·조선·사고 등 비운임 기사 수집 단계에서 차단 (lane_causal 안전망과 별개)
  {
    name: 'gCaptain Analysis',
    url: 'https://feeds.feedburner.com/gcaptain',
    type: 'rss',
    section: 'shipping',
    category: 'deep_analysis',
    topicFilter: /freight rate|container rate|ocean rate|shipping rate|carrier earning|TEU|FEU|SCFI|WCI|FBX|shipper|blank sailing|capacity|bunker|surcharge|GRI|peak season|Hormuz.*shipping|shipping.*Hormuz|Red Sea.*shipping|shipping.*disruption|port congestion|trade lane|vessel supply/i,
  },

  // ── 신규 소스 (본문 발췌로 깊이 확보) ──

  // 항공 화물 — air 섹션 공백 해소
  // WorldACD RSS: /feed/ URL이 article 링크 직접 포함 (확인됨)
  {
    name: 'WorldACD',
    url: 'https://www.worldacd.com/feed/',
    type: 'rss',
    section: 'air',
    category: 'deep_analysis',
    topicFilter: /air cargo|airfreight|air freight|WorldACD|aviation cargo|belly|charter|TAC|yield|tonnage/i,
  },

  // 해운 심층 — Container News RSS (확인됨, slugURL 방식)
  {
    name: 'Container News',
    url: 'https://container-news.com/feed/',
    type: 'rss',
    section: 'shipping',
    category: 'deep_analysis',
  },

  // ── 철도 (TCR/TSR/CIS) — 영문 전용 3개, 번역 불필요 ──
  // RailFreight: 본문 skip(부분 유료벽). SeaNews·Global Times: 본문 발췌 양호.
  { name: 'RailFreight BeltAndRoad', url: 'https://www.railfreight.com/category/beltandroad/feed/',
    type: 'rss', section: 'rail', category: 'deep_analysis' },
  { name: 'RailFreight Russia', url: 'https://www.railfreight.com/tag/russia/feed/',
    type: 'rss', section: 'rail', category: 'deep_analysis' },
  { name: 'SeaNews EN', url: 'https://seanews.ru/en/feed/',
    type: 'rss', section: 'rail', category: 'deep_analysis' },
  { name: 'Global Times BRI', url: 'https://www.globaltimes.cn/rss/outbrain.xml',
    type: 'rss', section: 'rail', category: 'deep_analysis' },

  // Xeneta: 항로별 운임 데이터 분석 블로그 (확인됨 — 본문 추출 가능)
  // urlPattern: xeneta.com/blog/(슬러그) (확인됨)
  {
    name: 'Xeneta',
    url: 'https://www.xeneta.com/blog',
    type: 'html',
    section: 'shipping',
    category: 'deep_analysis',
    urlPattern: /xeneta\.com\/blog\/[a-z0-9][a-z0-9-]+$/,
  },
];

const MONTHLY_SOURCES: MonthlySource[] = [
  ...MONTHLY_SOURCES_BASE,
  ...NEWS_SOURCES
    .filter((source) => source.monthly && !MONTHLY_SOURCES_BASE.some((item) => item.name === source.name))
    .map((source): MonthlySource => ({
      name: source.name,
      url: source.url,
      type: source.kind,
      section: source.section === 'logistics' ? 'trade' : source.section,
      category: 'deep_analysis',
    })),
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
    if (BAD_TITLE.test(title.trim())) continue;   // 사이트명/카테고리 헤더 skip
    items.push({
      title,
      url: link,
      published_at: pub ? new Date(pub).toISOString() : new Date().toISOString(),
      summary_en: desc.replace(/<[^>]+>/g, '').slice(0, 400),
      source: src.name,
    });
    if (items.length >= 10) break;  // 월간 분석은 10건
  }
  return src.topicFilter
    ? items.filter(i => src.topicFilter!.test(`${i.title} ${i.summary_en || ''}`))
    : items;
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

// Linerlytica /tag/marketpulse/ — SSR 목록 1회 fetch로 최근 6주치 Market Pulse 인트로 추출.
// 각 글 블록: [링크(제목)] → [날짜] → "Register Free Trial" → [항로별 원인 인트로 문단]
async function fetchLinerlytica(src: MonthlySource): Promise<NewsItem[]> {
  const res = await fetch(src.url, { headers: BOT_HEADERS, signal: AbortSignal.timeout(12000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();

  const items: NewsItem[] = [];
  // 앵커 내부 제목이 <h2> 자식 요소로 감싸져 있으므로 [\s\S]*? 로 캡처 후 태그 제거
  const linkRe = /<a[^>]+href="(\/post\/market-pulse-[^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  const linkMatches = Array.from(html.matchAll(linkRe));

  for (let i = 0; i < linkMatches.length; i++) {
    const m = linkMatches[i];
    const url   = `https://www.linerlytica.com${m[1]}`;
    const title = m[2].replace(/<[^>]+>/g, '').trim();
    const start = (m.index ?? 0) + m[0].length;
    const end   = i + 1 < linkMatches.length
      ? (linkMatches[i + 1].index ?? start)
      : Math.min(start + 4000, html.length);
    const chunk = html.slice(start, end);

    // HTML 태그 제거 → 평문
    const text = chunk.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

    // 날짜 추출 (예: "May 26, 2026")
    const dm = text.match(/([A-Z][a-z]+ \d{1,2}, \d{4})/);
    const published_at = dm ? new Date(dm[1]).toISOString() : new Date().toISOString();

    // 인트로: "Register Free Trial" 이후 본문, 없으면 날짜 이후 텍스트
    let intro = text;
    const rfIdx = text.indexOf('Register Free Trial');
    if (rfIdx >= 0) {
      intro = text.slice(rfIdx + 'Register Free Trial'.length).trim();
    } else if (dm) {
      intro = text.slice((dm.index ?? 0) + dm[1].length).trim();
    }
    // "MARKET BRIEF ..." 머리표 제거, 600자 컷
    intro = intro.replace(/^MARKET BRIEF[^.]*?\.\s*/i, '').trim().slice(0, 600);

    if (!title || intro.length < 40) continue;
    items.push({ title, url, published_at, summary_en: intro, source: src.name });
    if (items.length >= 6) break;  // 최근 6주 (한 달+여유)
  }
  return items;
}

export async function collect(): Promise<CollectorResult> {
  const result: CollectorResult = { section: 'shipping', data: [] };

  const settled = await Promise.allSettled(
    MONTHLY_SOURCES.map(src => rateLimited(src.url, () => {
      if (src.type === 'rss')         return parseRss(src);
      if (src.type === 'linerlytica') return fetchLinerlytica(src);
      return fetchHtmlLinks(src);
    }))
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
    // Linerlytica는 fetchLinerlytica가 이미 인트로를 summary_en에 넣었으므로 본문 skip(유료벽)
    const SKIP_BODY = new Set(['Linerlytica Market Pulse', 'RailFreight BeltAndRoad', 'RailFreight Russia']);
    for (const item of res.value) {
      let content = '';
      if (!SKIP_BODY.has(src.name) && item.url?.startsWith('http')) {
        content = await fetchArticleBody(item.url);  // 실패 시 '' — 수집 안 막음
      }
      result.data.push({
        data_type: 'monthly_source',
        data_key: `MONTHLY_${src.category}_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        data_value: { ...item, content, section: src.section, language: 'en', category: src.category },
        source: src.name, source_url: src.url, is_complete: true,
      });
    }
    const bodyCount = res.value.filter((_, idx) => {
      return !SKIP_BODY.has(src.name) && res.value[idx]?.url?.startsWith('http');
    }).length;
    console.log(`✅ ${src.name}: ${res.value.length}건 (본문 발췌 시도 ${bodyCount}건)`);
  }

  const success = result.data.filter(d => d.is_complete).length;
  console.log(`\n✅ monthly_analysis: ${success}건 수집 완료`);
  return result;
}

if (require.main === module) {
  collect().then(r => snapshotWriter(r)).catch(console.error);
}
