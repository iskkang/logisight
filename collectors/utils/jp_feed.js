'use strict';
// 일본 매체 RSS 파싱. CDATA·복수 category·깨진 날짜가 섞여 조용히 틀리기 쉬워 따로 뒀다.
// LOGISTICS TODAY·LNEWS 둘 다 WordPress라 형태가 같다.

const strip = (s) => String(s || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
const cdata = (s) => String(s || '').replace(/^\s*<!\[CDATA\[/, '').replace(/\]\]>\s*$/, '').trim();

function pick(block, name) {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? cdata(m[1]) : '';
}

/**
 * @param {string} xml
 * @param {string} source 매체명
 * @returns {{title:string,url:string,source:string,publishedAt:string|null,tags:string[],blurb:string}[]}
 */
function parseJpFeed(xml, source) {
  return [...String(xml).matchAll(/<item[\s>][\s\S]*?<\/item>/gi)]
    .map((m) => {
      const b = m[0];
      const raw = pick(b, 'pubDate');
      const t = raw ? new Date(raw) : null;
      return {
        title: strip(pick(b, 'title')),
        url: pick(b, 'link'),
        source,
        // 날짜가 깨져도 기사를 버리지 않는다. 날짜만 비운다.
        publishedAt: t && Number.isFinite(t.getTime()) ? t.toISOString() : null,
        tags: [...b.matchAll(/<category[^>]*>([\s\S]*?)<\/category>/gi)].map((c) => strip(cdata(c[1]))),
        blurb: strip(pick(b, 'description')),
      };
    })
    // 제목이나 링크가 없으면 기사로 쓸 수 없다.
    .filter((x) => x.title && x.url);
}

module.exports = { parseJpFeed };
