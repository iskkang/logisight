'use strict';
// 섹션 키워드로 최근 N일 뉴스 필터 + 제목 dedup. 순수 함수.

function filterNews(items, keywords, now, days = 7, limit = 12) {
  const since = now.getTime() - days * 86400000;
  const kw = keywords.map(k => k.toLowerCase());
  const seen = new Set();
  const out = [];
  for (const it of items || []) {
    if (!it || !it.title || !it.url) continue;
    if (it.published_at) {
      const t = Date.parse(it.published_at);
      if (!isNaN(t) && t < since) continue;
    }
    const hay = `${it.title} ${it.summary_en || ''}`.toLowerCase();
    if (kw.length && !kw.some(k => hay.includes(k))) continue;
    if (seen.has(it.title)) continue;
    seen.add(it.title);
    out.push(it);
    if (out.length >= limit) break;
  }
  return out;
}

module.exports = { filterNews };
