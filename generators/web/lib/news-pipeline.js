'use strict';

const CATEGORY_MAP = {
  shipping: '해상',
  ocean: '해상',
  air: '항공',
  rail: '철도',
  trade: '무역',
  policy: '무역',
  logistics: '물류',
};

function categoryFor(section) {
  return CATEGORY_MAP[section] || '물류';
}

function absoluteUrl(value, pageUrl) {
  if (!value || value === 'null') return null;
  try {
    return new URL(value, pageUrl).href;
  } catch {
    return null;
  }
}

function metaContent(html, key, attr) {
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

function extractJsonLdImage(html) {
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
      // Ignore malformed JSON-LD.
    }
  }
  return null;
}

function stripHtml(value) {
  return String(value || '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

async function fetchUnsplash(keyword) {
  const key = process.env.UNSPLASH_ACCESS_KEY;
  if (!key) return null;
  const url = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(keyword)}&orientation=landscape&per_page=1&client_id=${key}`;
  try {
    const response = await fetch(url, {
      headers: { 'Accept-Version': 'v1' },
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) return null;
    const photo = (await response.json())?.results?.[0];
    if (!photo?.urls?.regular) return null;
    const photographer = photo.user?.name || photo.user?.username || 'Unsplash';
    return {
      imageUrl: `${photo.urls.regular}&w=1200&h=675&fit=crop`,
      imageSource: 'unsplash',
      imageCredit: `Photo: ${photographer} / Unsplash`,
    };
  } catch {
    return null;
  }
}

async function resolveArticle(url, { source, keyword, title } = {}) {
  let html = '';
  let extracted = null;
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Logisight/1.0)' },
      signal: AbortSignal.timeout(12000),
    });
    if (response.ok) html = await response.text();
  } catch {
    html = '';
  }

  if (html) {
    try {
      const { extractFromHtml } = await import('@extractus/article-extractor');
      extracted = await extractFromHtml(html, url);
    } catch {
      extracted = null;
    }
  }

  const originalImage = absoluteUrl(metaContent(html, 'og:image', 'property'), url)
    || absoluteUrl(metaContent(html, 'twitter:image', 'name'), url)
    || absoluteUrl(metaContent(html, 'twitter:image:src', 'name'), url)
    || absoluteUrl(extractJsonLdImage(html), url)
    || absoluteUrl(extracted?.image, url);
  const articleText = stripHtml(extracted?.content).slice(0, 7000);

  if (originalImage) {
    return {
      imageUrl: originalImage,
      imageSource: 'original',
      imageCredit: source || new URL(url).hostname,
      articleText,
    };
  }

  const unsplash = await fetchUnsplash(`${keyword || ''} ${title || ''}`.trim());
  return {
    imageUrl: unsplash?.imageUrl || null,
    imageSource: unsplash?.imageSource || null,
    imageCredit: unsplash?.imageCredit || null,
    articleText,
  };
}

function buildMainContent(main) {
  return [
    main.what && `## 현상\n\n${main.what}`,
    main.why_now && `## 원인과 배경\n\n${main.why_now}`,
    main.checkpoint && `## 한국 화주·포워더 영향\n\n${main.checkpoint}`,
  ].filter(Boolean).join('\n\n');
}

async function generateKoreanAnalysis(callDeepSeek, articleText, context) {
  if (!articleText || articleText.length < 150 || !process.env.DEEPSEEK_API_KEY) return null;
  const message = await callDeepSeek({
    max_tokens: 900,
    messages: [{
      role: 'user',
      content: `아래 원문 기사에서 확인되는 사실만 사용해 한국어 요약·분석 본문을 작성하라.
원문 전체 번역이나 장문 복제는 금지한다. 출처에 없는 수치나 사실을 만들지 마라.
반드시 "## 현상", "## 원인과 배경", "## 한국 화주·포워더 영향" 세 구역으로 작성하고, 제목·부제·이미지·credit·출처 문장은 넣지 마라.

기사 맥락: ${context}

원문 발췌:
${articleText}`,
    }],
  });
  const text = message.content?.[0]?.text?.trim();
  return text && text.length >= 100 ? text : null;
}

function normalizeMarkdownBody(markdown, { title, summary, imageUrl, imageCredit } = {}) {
  let body = String(markdown || '').replace(/^---[\s\S]*?---\s*/m, '').trim();
  const escapedTitle = title ? title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : null;
  const escapedSummary = summary ? summary.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : null;
  if (escapedTitle) body = body.replace(new RegExp(`^#\\s+${escapedTitle}\\s*\\n+`, 'i'), '');
  if (escapedSummary) body = body.replace(new RegExp(`^##\\s+${escapedSummary}\\s*\\n+`, 'i'), '');
  if (imageUrl) {
    body = body.replace(new RegExp(`!\\[[^\\]]*\\]\\(${imageUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\)\\s*`, 'g'), '');
  }
  if (imageCredit) {
    body = body.replace(new RegExp(`\\*?${imageCredit.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\*?\\s*`, 'gi'), '');
  }
  return body.replace(/\n{3,}/g, '\n\n').trim();
}

module.exports = {
  CATEGORY_MAP,
  buildMainContent,
  categoryFor,
  generateKoreanAnalysis,
  normalizeMarkdownBody,
  resolveArticle,
};
