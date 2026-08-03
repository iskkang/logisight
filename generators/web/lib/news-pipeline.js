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
  const raw = String(value).trim();
  if (!raw || /["'<>]|%(?:22|27|3c|3e)|&(?:quot|apos|#0*3[49]);/i.test(raw)) return null;
  try {
    const url = new URL(raw, pageUrl);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

function sanitizeImageUrl(value) {
  if (!value) return null;
  const raw = String(value).trim();
  if (!raw || /["'<>]|%(?:22|27|3c|3e)|&(?:quot|apos|#0*3[49]);/i.test(raw)) return null;
  try {
    const url = new URL(raw);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

// 기사 원문 URL 검증. 스킴 접두어(/^https?:\/\//)만 보면 앵커 쓰레기 값이 통과한다 —
// "https://javascript:void(0);"는 파싱에서, "https://javascript"는 호스트 검사에서 걸린다.
function sanitizeArticleUrl(value) {
  if (!value) return null;
  const raw = String(value).trim();
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.hostname.includes('.') ? url.href : null;
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

// 후보 중 한 장을 고른다. 1등만 쓰면 카테고리 검색어가 고정이라 같은 사진이 영원히 반복된다.
// 무작위가 아니라 시드(기사 URL) 해시로 고르는 이유 — 재발행해도 같은 기사는 같은 사진이어야
// 하고, 결정적이어야 테스트할 수 있다. FNV-1a.
function pickIndex(seed, length) {
  if (!Number.isInteger(length) || length <= 0) return 0;
  const text = String(seed ?? '');
  if (!text) return 0;
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % length;
}

async function fetchUnsplash(keyword, seed) {
  const key = process.env.UNSPLASH_ACCESS_KEY;
  if (!key) return null;
  const url = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(keyword)}&orientation=landscape&per_page=30&client_id=${key}`;
  try {
    const response = await fetch(url, {
      headers: { 'Accept-Version': 'v1' },
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) return null;
    const results = (await response.json())?.results;
    if (!Array.isArray(results) || results.length === 0) return null;
    const photo = results[pickIndex(seed, results.length)];
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

async function fetchUnsplashFallback({ keyword, title, source, seed } = {}) {
  const queries = [
    [keyword, title].filter(Boolean).join(' '),
    keyword,
    title,
    source,
    'global logistics cargo supply chain',
  ]
    .map((value) => String(value || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const seen = new Set();
  for (const query of queries) {
    const key = query.toLocaleLowerCase('en-US');
    if (seen.has(key)) continue;
    seen.add(key);
    const image = await fetchUnsplash(query, seed);
    if (image) return image;
  }
  return null;
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

  // 시드는 기사 URL — 기사마다 다른 사진이 되고, 같은 기사는 재발행해도 같은 사진이 된다.
  const unsplash = await fetchUnsplashFallback({ keyword, title, source, seed: url });
  return {
    imageUrl: unsplash?.imageUrl || null,
    imageSource: unsplash?.imageSource || null,
    imageCredit: unsplash?.imageCredit || null,
    articleText,
  };
}

function buildMainContent(main) {
  return [main.what, main.why_now, main.checkpoint]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .join('\n\n');
}

// callDeepSeek 응답에서 TITLE/BODY를 분리. 반환 { title, body } | null
function parseKsgArticle(text) {
  if (!text) return null;
  const titleMatch = text.match(/TITLE:\s*(.+?)\s*(?:\n|$)/);
  const bodyMatch = text.match(/BODY:\s*\n?([\s\S]+)$/);
  const title = titleMatch ? titleMatch[1].trim() : null;
  let body = bodyMatch ? bodyMatch[1].trim() : null;
  // TITLE/BODY 라벨이 없으면 전체를 본문으로 사용
  if (!body) body = (title ? text.replace(/TITLE:\s*.+\n?/, '') : text).trim();
  // 모델이 덧붙이는 말미 디스클레이머 제거 ("본 기사는 …작성됐습니다")
  body = body.replace(/(?:\n\s*)*본\s*기사는[^\n]*$/, '').trim();
  if (!body || body.length < 100) return null;
  return { title: title || null, body };
}

async function generateKoreanAnalysis(callDeepSeek, articleText, context) {
  if (!articleText || articleText.length < 150 || !process.env.DEEPSEEK_API_KEY) return null;
  const message = await callDeepSeek({
    max_tokens: 3000,
    messages: [{
      role: 'user',
      content: `아래 원문 기사에서 확인되는 사실만 사용해 한국어 뉴스 기사를 작성하라.
원문 전체 번역이나 장문 복제는 금지한다. 출처에 없는 수치나 사실을 만들지 마라.
KSG(코리아쉬핑가제트)·카고뉴스 전문기자 문체로 작성한다.

## 제목 규칙
- 명사형으로 종결한다. 핵심 키워드를 앞 15자 이내에 배치한다. 한글 기준 25~35자.
- 숫자·단위·국가는 한글로 쓴다: 달러·억·대비·미국·아시아·북미. 어려운 한자 약물(弗·億·比·美·亞·北·前倒·脫出 등)은 쓰지 않는다. 기호는 %·↑·↓·…만 쓴다.
- 업계 약어를 그대로 쓴다: TEU·FEU·소석률·컨운임·GRI·PSS·포워더
- 영문 사명은 원어로 쓴다: Maersk·MSC·CMA CGM·HMM·COSCO·ONE·DSV
- 과장 표현(최고·무조건·100%) 금지. 같은 키워드를 제목 안에서 2회 이상 반복 금지.
- 예: 중동행 컨운임 4300달러 돌파…사상최고치
- 예: 부산→유럽 운임 전주 대비 9%↑…홍해 우회 지속 영향

## 본문 규칙
- 5~7개 문단, 600~1,000자 안팎의 자연스러운 산문. 문단과 문단 사이는 빈 줄로 구분해 보기 좋게 한다.
- 첫 문단은 핵심 사실을 바로 제시하고, 중간 문단은 배경과 원인을 자연스럽게 연결하며, 마지막 문단은 한국 화주·포워더를 직접 언급하지 말고 향후 시장 전망으로 마무리한다. 마무리 도입은 매번 다르게 변주한다(예: '업계에서는…', '글로벌 공급망 차원에서…', '업계 전문가는 ~라고 했다', '시장에서는…' 등). 같은 도입 표현을 반복하지 않는다.
- 라벨형 소제목이나 H2 구획(현황·노선별·원인·전망 등)을 절대 쓰지 마라. 평문 산문으로만 작성한다.
- 어미는 KSG 문어체만 사용한다: ~을 기록했다·~을 밝혔다·~로 집계됐다·~로 전망했다·~고 말했다. ~입니다·~합니다·~됩니다·~했습니다는 절대 금지.
- 수치 표기: 병렬 수치에는 '각각'을 쓴다(예: 영업익·순익 각각 92% 감소). 비교는 '전년 [수치] 대비 [증감률] [결과]' 형식(예: 전년 1275만TEU 대비 1% 늘어난 1292만TEU). 증감률은 숫자+%, 퍼센트포인트는 %p.
- 접속어를 활용한다: 반면·이 밖에·이어·한편·가운데·희비·나 홀로 하락세.
- SEO: 메인 키워드를 1,000자 기준 4~6회 자연스럽게 반복한다.
- 출처 명시: 모든 수치·통계에 기관명을 밝히고, 본문 맨 끝에 한 줄로 '*출처: [기관명]*'을 단다.
- 제목·부제·이미지·credit 문장은 본문에 넣지 마라.

## 출력 형식 (정확히 준수)
TITLE: {제목}
BODY:
{본문}

기사 맥락: ${context}

원문 발췌:
${articleText}`,
    }],
  });
  const text = message.content?.[0]?.text?.trim();
  return parseKsgArticle(text);
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
  return body
    .replace(/^##\s*(현상|원인과 배경|한국 화주[·ㆍ\-\s]*포워더 영향)\s*$/gim, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

module.exports = {
  CATEGORY_MAP,
  buildMainContent,
  categoryFor,
  pickIndex,
  sanitizeArticleUrl,
  generateKoreanAnalysis,
  normalizeMarkdownBody,
  parseKsgArticle,
  resolveArticle,
  sanitizeImageUrl,
};
