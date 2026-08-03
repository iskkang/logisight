'use strict';
// generators/jp-report/assemble/seo.js
// assembler — 리포트 마크다운에서 SEO 메타를 만든다.
// 기준은 write/SEO.ja.md (구글 일본어 검색). 네이버는 대상이 아니다.

const SITE_NAME = 'Logisight';
const MAX_TITLE = 32; // 전각 기준. 넘으면 구글 검색결과에서 잘린다.
const MAX_DESC = 70;

const periodJa = (period) => {
  const [y, m] = String(period || '').split('-');
  return y && m ? `${y}年${Number(m)}月` : String(period || '');
};

/** 총론 제목의 '01. 総論 ― ' 뒤 헤드라인. 리포트를 한 줄로 요약한 부분이다. */
function deriveHeadline(markdown) {
  const line = String(markdown || '').split('\n').find((l) => /^#+\s*01\./.test(l));
  if (!line) return null;
  const after = line.replace(/^#+\s*01\.\s*/, '').replace(/^総論\s*/, '');
  const headline = after.replace(/^[―—\-:：]\s*/, '').trim();
  return headline || null;
}

function deriveTitle(markdown, period) {
  const suffix = ` ― ${periodJa(period)} 物流市況`;
  const headline = deriveHeadline(markdown);
  if (!headline) return `${periodJa(period)} 物流市況レポート`;
  const room = MAX_TITLE - suffix.length;
  const head = headline.length > room ? headline.slice(0, Math.max(room - 1, 1)).trimEnd() : headline;
  return `${head}${suffix}`;
}

/** 첫 본문 문단. 제목·구분선·목록은 본문이 아니다. */
function deriveDescription(markdown) {
  const body = String(markdown || '')
    .split('\n')
    .filter((l) => l.trim() && !/^#/.test(l) && !/^-{3,}$/.test(l) && !/^[-*]\s/.test(l))[0];
  if (!body) return '';
  const clean = body.replace(/\s+/g, '').trim();
  return clean.length > MAX_DESC ? `${clean.slice(0, MAX_DESC - 1)}…` : clean;
}

function buildJsonLd({ title, description, period, url, publishedAt, logo }) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: title,
    description,
    inLanguage: 'ja',
    datePublished: publishedAt || new Date().toISOString(),
    dateModified: publishedAt || new Date().toISOString(),
    author: { '@type': 'Organization', name: SITE_NAME },
    publisher: {
      '@type': 'Organization',
      name: SITE_NAME,
      ...(logo ? { logo: { '@type': 'ImageObject', url: logo } } : {}),
    },
    mainEntityOfPage: url,
    about: `${periodJa(period)}の日本の物流市況(運賃・港湾・貿易)`,
  };
}

module.exports = { deriveHeadline, deriveTitle, deriveDescription, buildJsonLd, periodJa, SITE_NAME };
