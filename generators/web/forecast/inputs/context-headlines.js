'use strict';
// v1.3: context_headlines — maritime_news 최근 14일을 타깃 노선·트레이드 키워드로 필터.
// narrate(Plan C)가 인용할 외부 맥락은 이 목록에 한정. 점수에는 영향 없음.

const REGION_TERMS = {
  미주: [/미주|미국|US\b|transpacific|west coast|east coast|로스앤젤레스|롱비치|long beach|뉴욕|savannah/i],
  EU: [/유럽|europe|EU\b|rotterdam|로테르담|hamburg|함부르크|antwerp|suez|홍해|red sea|희망봉|cape of good hope/i],
  동남아: [/동남아|southeast asia|vietnam|베트남|호치민|싱가포르|singapore|방콕|말레이시아/i],
};

// newsRows: [{title, summary, source, published_at}]. target/region으로 필터, 최대 8건.
function buildContextHeadlines(newsRows, target, region) {
  const res = REGION_TERMS[region] || [];
  const dest = target && target.dest ? String(target.dest) : '';
  const matched = (newsRows || []).filter((n) => {
    const hay = `${n.title || ''} ${n.summary || ''}`;
    return (dest && hay.includes(dest)) || res.some((re) => re.test(hay));
  });
  // 노선·권역 매칭이 없으면 일반 최근 헤드라인으로 폴백(맥락 제공).
  const pick = (matched.length ? matched : newsRows || []).slice(0, 8);
  return pick.map((n) => ({ title: n.title, source: n.source, published: n.published_at || n.published || null }));
}

module.exports = { buildContextHeadlines, REGION_TERMS };
