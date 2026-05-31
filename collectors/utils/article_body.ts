// collectors/utils/article_body.ts
// 기사 URL → 본문 텍스트 추출. 실패해도 절대 throw하지 않음(수집 전체를 막지 않게).
// 1차: @extractus/article-extractor (사이트 구조 자동 판별)
// 2차: 직접 fetch + <article> 또는 <p> 태그 정규식 폴백

import { extract } from '@extractus/article-extractor';

const MAX_LEN = 2500;
const BOT_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml',
  'Accept-Language': 'en-US,en;q=0.9',
};

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/&#8217;/g, "'").replace(/&quot;/g, '"').replace(/&#\d+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function regexFallback(html: string): string {
  // 1) <article> 우선
  const art = html.match(/<article[\s\S]*?<\/article>/i);
  if (art) {
    // <p> 태그 내 텍스트만 추출해 CSS 노이즈 제거
    const ps = [...art[0].matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)]
      .map(m => stripHtml(m[1]))
      .filter(t => t.length > 40 && !/^[\s\d.,:;()]+$/.test(t));
    if (ps.length) return ps.join('\n\n').slice(0, MAX_LEN);
    const full = stripHtml(art[0]);
    if (full.length > 200) return full.slice(0, MAX_LEN);
  }
  // 2) <p> 태그 전체에서 본문 후보 추출
  const ps = [...html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)]
    .map(m => stripHtml(m[1]))
    .filter(t => t.length > 60 && !/cookie|privacy|subscribe|newsletter/i.test(t));
  if (ps.length) return ps.join('\n\n').slice(0, MAX_LEN);
  return '';
}

export async function fetchArticleBody(url: string): Promise<string> {
  // 1차: article-extractor
  try {
    const article = await extract(url, {}, {
      headers: BOT_HEADERS,
      signal: AbortSignal.timeout(15000),
    } as RequestInit);
    if (article?.content) {
      const text = stripHtml(article.content);
      if (text.length > 200) return text.slice(0, MAX_LEN);
    }
  } catch {
    // extractor 실패 → 폴백
  }
  // 2차: 직접 fetch + 정규식 폴백
  try {
    const res = await fetch(url, { headers: BOT_HEADERS, signal: AbortSignal.timeout(12000) });
    if (!res.ok) return '';
    const html = await res.text();
    return regexFallback(html);
  } catch {
    return '';
  }
}
