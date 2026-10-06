import { extractFromHtml } from '@extractus/article-extractor';
import { XMLParser } from 'fast-xml-parser';

import { CATEGORY_BY_SECTION, type NewsSection, type NewsSource } from '../news_sources';
import type { CollectorResult, NewsItem } from '../types';
import { dbUpsert } from './supabase_writer';

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  Accept: 'application/rss+xml, application/xml, text/xml, text/html, */*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function textValue(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return String(record['#text'] ?? record['@_href'] ?? '').trim();
  }
  return '';
}

function parseDate(value: unknown): string | null {
  const text = textValue(value);
  if (!text) return null;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function stripHtml(value: unknown): string {
  return textValue(value)
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// RSS/Atom XML 문자열 → NewsItem[]. (fetch는 호출측에서 — 일반 fetch 또는 브라우저 in-page fetch)
export function parseFeedXml(xml: string, source: NewsSource, limit = 15): NewsItem[] {
  const parser = new XMLParser({ ignoreAttributes: false, cdataPropName: '#text' });
  const parsed = parser.parse(xml);
  const rawItems = [
    ...asArray(parsed?.rss?.channel?.item),
    ...asArray(parsed?.feed?.entry),
  ];

  const items: NewsItem[] = [];
  for (const raw of rawItems) {
    const title = textValue(raw.title);
    const links = asArray(raw.link);
    const url = links.map(textValue).find((link) => /^https?:\/\//.test(link))
      || textValue(raw.guid);
    if (!title || !url) continue;

    items.push({
      title,
      url,
      published_at: parseDate(raw.pubDate ?? raw.published ?? raw.updated ?? raw.date),
      summary_en: stripHtml(raw.description ?? raw.summary ?? raw.content).slice(0, 500),
      source: source.name,
    });
    if (items.length >= limit) break;
  }
  return items;
}

export async function parseNewsFeed(source: NewsSource, limit = 15): Promise<NewsItem[]> {
  const response = await fetch(source.url, { headers: HEADERS, signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${source.url}`);
  return parseFeedXml(await response.text(), source, limit);
}

function absoluteUrl(value: string | undefined, pageUrl: string): string | null {
  if (!value || value === 'null') return null;
  const raw = value.trim();
  if (!raw || /["'<>]|%(?:22|27|3c|3e)|&(?:quot|apos|#0*3[49]);/i.test(raw)) return null;
  try {
    const url = new URL(raw, pageUrl);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

function metaContent(html: string, key: string, attr: 'property' | 'name'): string | null {
  const patterns = [
    new RegExp(`<meta[^>]+${attr}=["']${key}["'][^>]+content=["']([^"']+)["']`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+${attr}=["']${key}["']`, 'i'),
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return match[1].trim();
  }
  return null;
}

function jsonLdImage(html: string): string | null {
  for (const match of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const parsed = JSON.parse(match[1]);
      const nodes = Array.isArray(parsed) ? parsed : [parsed];
      for (const node of nodes) {
        const image = node?.image;
        if (typeof image === 'string') return image;
        if (Array.isArray(image) && typeof image[0] === 'string') return image[0];
        if (image && typeof image.url === 'string') return image.url;
      }
    } catch {
      // Ignore invalid JSON-LD blocks.
    }
  }
  return null;
}

export async function enrichNewsItem(item: NewsItem): Promise<NewsItem> {
  try {
    const response = await fetch(item.url, { headers: HEADERS, signal: AbortSignal.timeout(12000) });
    if (!response.ok) return item;
    const html = await response.text();

    const ogImage = absoluteUrl(metaContent(html, 'og:image', 'property') ?? undefined, item.url);
    const twitterImage = absoluteUrl(
      metaContent(html, 'twitter:image', 'name')
        ?? metaContent(html, 'twitter:image:src', 'name')
        ?? undefined,
      item.url,
    );
    const structuredImage = absoluteUrl(jsonLdImage(html) ?? undefined, item.url);

    let extracted: Awaited<ReturnType<typeof extractFromHtml>> | null = null;
    try {
      extracted = await extractFromHtml(html, item.url);
    } catch {
      extracted = null;
    }

    const image = ogImage
      ?? twitterImage
      ?? structuredImage
      ?? absoluteUrl(extracted?.image, item.url);
    const content = stripHtml(extracted?.content).slice(0, 5000);

    return {
      ...item,
      content: content || item.content,
      og_image: image ?? item.og_image,
      image_source: image ? 'original' : item.image_source,
      image_credit: image ? item.source : item.image_credit,
    };
  } catch {
    return item;
  }
}

// Postgres 는 텍스트에 NUL(U+0000)을 담지 못한다 —— "unsupported Unicode escape
// sequence" 로 거절한다. 기사 본문을 긁다 보면 로그인 위젯 같은 데서 섞여 들어온다
// (2026-10 Evri 기사: "remember me on this device \u0000\u0000\u0000\u0000 Related
// Stories"). 한 건만 섞여도 배치 전체가 거절되므로 —— 그날 수집한 220건이 통째로
// 사라진다 —— 저장 직전에 턴다. 짝 없는 서러게이트도 같은 이유로 턴다(정상 이모지·
// CJK 확장은 쌍으로 들어오므로 영향 없다).
function pgSafeString(s: string): string {
  return s
    .replace(/\u0000/g, '')
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, '')
    .replace(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '');
}

function pgSafeRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(row)) {
    const v = row[key];
    out[key] = typeof v === 'string' ? pgSafeString(v) : v;
  }
  return out;
}

export async function persistCollectedNews(result: CollectorResult): Promise<void> {
  const rowsByUrl = new Map<string, Record<string, unknown>>();
  for (const datum of result.data) {
    if (!datum.is_complete) continue;
    const item = datum.data_value as NewsItem & { section?: NewsSection; language?: string };
    if (!item.url || !item.title) continue;
    const section = item.section ?? result.section;
    const category = CATEGORY_BY_SECTION[section as keyof typeof CATEGORY_BY_SECTION] ?? '물류';
    rowsByUrl.set(item.url, pgSafeRow({
      title: item.title.slice(0, 500),
      url: item.url,
      source: item.source || datum.source,
      published_at: item.published_at,
      summary: (item.summary_en || '').slice(0, 500) || null,
      content: item.content || null,
      lang: item.language ?? 'en',
      category,
      tags: [section],
      image_url: item.og_image || null,
      image_source: item.image_source || null,
      image_credit: item.image_credit || null,
      agent_type: 'external',
      slug: null,
      fetched_at: new Date().toISOString(),
    }));
  }
  // 충돌 키는 (url, lang) 이다 ★
  // 2026-08-06 마이그레이션(20260806000001)이 maritime_news_url_key 를 떼고
  // maritime_news_url_lang_key unique (url, lang) 을 달았다. 그런데 여기만 'url' 로
  // 남아, 그날 이후 모든 upsert 가 "no unique or exclusion constraint matching the
  // ON CONFLICT specification" 으로 실패했다. 호출부가 이 에러를 삼키고 "persist
  // skipped" 로만 찍는 탓에 수집기는 계속 성공으로 끝났고, external 기사는 7월 606건
  // → 9월 16건 → 10월 2건으로 조용히 말랐다. news_jp.ts 는 같은 날 고쳐졌는데
  // 이 경로만 빠졌다 —— 일본 뉴스는 멀쩡하고 external 만 끊긴 이유다.
  await dbUpsert('maritime_news', [...rowsByUrl.values()], 'url,lang');
}
