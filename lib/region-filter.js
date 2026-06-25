// 순수 함수. 네트워크/IO 없음. 단위 검증 대상.
function scoreArticle(article, cfg) {
  const text = [
    article.title || '',
    article.summary || article.description || '',
    article.content || '',
  ].join(' ').toLowerCase();

  const countHits = (terms) =>
    terms.reduce((n, t) => n + (text.includes(String(t).toLowerCase()) ? 1 : 0), 0);

  const regionScore = countHits(cfg.geoKeywords);
  const koreaScore = countHits(cfg.koreaAnchors);
  const excluded = (cfg.excludeKeywords || []).some(
    (t) => text.includes(String(t).toLowerCase())
  );

  const pass = !excluded && regionScore >= 1 && koreaScore >= 1;
  const relevance = regionScore + koreaScore * 2; // 한국 연관 가중

  return { regionScore, koreaScore, relevance, pass };
}

// 통과 기사만, relevance 내림차순, 상위 limit
function filterByRegion(articles, cfg, limit = 12) {
  return articles
    .map((a) => ({ article: a, ...scoreArticle(a, cfg) }))
    .filter((x) => x.pass)
    .sort((a, b) => b.relevance - a.relevance)
    .slice(0, limit)
    .map((x) => x.article);
}

module.exports = { scoreArticle, filterByRegion };
